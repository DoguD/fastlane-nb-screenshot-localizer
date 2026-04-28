import { RateLimiter, sleep } from '../concurrency.js';
import { toDataUri } from '../image.js';
import type { Provider, ProviderRequest, ProviderResult, Variant } from '../types.js';

const QUEUE_BASE_URL = 'https://queue.fal.run';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 3;

interface ModelConfig {
  slug: string;
  inputExtras: Record<string, unknown>;
}

const MODEL_CONFIGS: Record<Variant, ModelConfig> = {
  standard: {
    slug: 'fal-ai/nano-banana-2/edit',
    inputExtras: { aspect_ratio: 'auto', resolution: '1K', batch_size: 1 },
  },
  pro: {
    slug: 'fal-ai/nano-banana-pro/edit',
    inputExtras: { aspect_ratio: 'auto', output_format: 'jpeg', resolution: '2K', num_images: 1 },
  },
};

// Note on image input: fal accepts URLs (preferred) or data URIs (tolerated in
// queue mode per their docs). If you start seeing 4xx errors on submit, switch
// to fal's storage upload (POST .../storage/upload/initiate) and pass the
// resulting public URL instead, or set `sync_mode: true` and POST to
// https://fal.run/<slug> for a single round-trip with data-URI in/out.

export class FalProvider implements Provider {
  readonly name = 'fal' as const;
  readonly variant: Variant;
  readonly pricePerImage: number;
  private readonly model: ModelConfig;
  private readonly rateLimiter: RateLimiter;
  private readonly headers: Record<string, string>;

  constructor(apiKey: string, pro: boolean, rateLimitRpm: number) {
    this.variant = pro ? 'pro' : 'standard';
    this.model = MODEL_CONFIGS[this.variant];
    this.pricePerImage = pro ? 0.15 : 0.08;
    this.rateLimiter = new RateLimiter(rateLimitRpm);
    this.headers = {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async translate(req: ProviderRequest): Promise<ProviderResult> {
    const dataUri = toDataUri(req.imageBuffer, req.mimeType);
    const submission = await this.submit(dataUri, req.prompt);
    await this.pollUntilDone(submission.status_url, submission.request_id);
    const result = await this.fetchResult(submission.response_url);

    const url = result.images?.[0]?.url;
    if (!url) {
      throw new Error(`No output URL in fal result: ${JSON.stringify(result)}`);
    }

    const outputBuffer = await this.downloadImage(url);
    return { outputBuffer, predictionId: submission.request_id };
  }

  private async submit(imageDataUri: string, prompt: string): Promise<FalSubmission> {
    const payload = {
      prompt,
      image_urls: [imageDataUri],
      ...this.model.inputExtras,
    };
    const url = `${QUEUE_BASE_URL}/${this.model.slug}`;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.rateLimiter.acquire();
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(payload),
        });

        if (resp.status === 429) {
          const wait = Math.pow(2, attempt + 1) * 5_000;
          console.error(`  Rate limited, waiting ${wait / 1000}s...`);
          await sleep(wait);
          continue;
        }

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        }

        const data = (await resp.json()) as Partial<FalSubmission>;
        if (!data.request_id || !data.status_url || !data.response_url) {
          throw new Error(`Malformed fal submit response: ${JSON.stringify(data)}`);
        }
        return data as FalSubmission;
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) throw err;
        const wait = Math.pow(2, attempt + 1) * 1_000;
        console.error(`  Request error (${(err as Error).message}), retrying in ${wait / 1000}s...`);
        await sleep(wait);
      }
    }
    throw new Error('Max retries exceeded for submit');
  }

  private async pollUntilDone(statusUrl: string, requestId: string): Promise<void> {
    const start = Date.now();
    while (true) {
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        throw new Error(`Request ${requestId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
      }
      await sleep(POLL_INTERVAL_MS);

      const resp = await fetch(statusUrl, { headers: this.headers });
      if (!resp.ok) {
        throw new Error(`Status check ${resp.status}: ${await resp.text()}`);
      }
      const data = (await resp.json()) as FalStatus;

      if (data.status === 'COMPLETED') return;
      if (data.error || data.error_type) {
        throw new Error(`fal request ${requestId} failed: ${data.error_type ?? ''} ${data.error ?? ''}`);
      }
    }
  }

  private async fetchResult(responseUrl: string): Promise<FalResult> {
    const resp = await fetch(responseUrl, { headers: this.headers });
    if (!resp.ok) {
      throw new Error(`Result fetch ${resp.status}: ${await resp.text()}`);
    }
    return (await resp.json()) as FalResult;
  }

  private async downloadImage(url: string): Promise<Buffer> {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Download ${resp.status}: ${resp.statusText}`);
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  }
}

interface FalSubmission {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
}

interface FalStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | string;
  error?: string;
  error_type?: string;
  queue_position?: number;
}

interface FalResult {
  images?: Array<{ url: string; content_type?: string; width?: number; height?: number }>;
  description?: string;
}
