import { RateLimiter, sleep } from '../concurrency.js';
import { toDataUri } from '../image.js';
import type { Provider, ProviderRequest, ProviderResult, Variant } from '../types.js';

const API_BASE_URL = 'https://api.eachlabs.ai';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 300_000;
const MAX_RETRIES = 3;

interface ModelConfig {
  slug: string;
  version: string;
  inputExtras: Record<string, unknown>;
}

const MODEL_CONFIGS: Record<Variant, ModelConfig> = {
  standard: {
    slug: 'nano-banana-2-edit',
    version: '0.0.1',
    inputExtras: { resolution: '1K', aspect_ratio: 'Auto', output_format: 'jpeg' },
  },
  pro: {
    slug: 'nano-banana-pro-edit',
    version: '1.0.0',
    inputExtras: { resolution: '2K', output_format: 'jpeg' },
  },
};

export class EachLabsProvider implements Provider {
  readonly name = 'eachlabs' as const;
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
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    };
  }

  async translate(req: ProviderRequest): Promise<ProviderResult> {
    const dataUri = toDataUri(req.imageBuffer, req.mimeType);
    const predictionId = await this.createPrediction(dataUri, req.prompt);
    const result = await this.pollPrediction(predictionId);

    if (result.status !== 'success') {
      throw new Error(
        `Prediction ${predictionId} ${result.status}: ${result.logs ?? 'no details'}`,
      );
    }

    const url = pickOutputUrl(result.output);
    if (!url) {
      throw new Error(`No output URL in prediction result: ${JSON.stringify(result)}`);
    }

    const outputBuffer = await this.downloadImage(url);
    return {
      outputBuffer,
      predictionId: result.id ?? predictionId,
    };
  }

  private async createPrediction(imageDataUri: string, prompt: string): Promise<string> {
    const payload = {
      model: this.model.slug,
      version: this.model.version,
      input: {
        prompt,
        image_urls: [imageDataUri],
        num_images: 1,
        ...this.model.inputExtras,
      },
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.rateLimiter.acquire();
      try {
        const resp = await fetch(`${API_BASE_URL}/v1/prediction`, {
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

        const data = (await resp.json()) as { predictionID?: string };
        if (!data.predictionID) {
          throw new Error(`Missing predictionID in response: ${JSON.stringify(data)}`);
        }
        return data.predictionID;
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) throw err;
        const wait = Math.pow(2, attempt + 1) * 1_000;
        console.error(`  Request error (${(err as Error).message}), retrying in ${wait / 1000}s...`);
        await sleep(wait);
      }
    }
    throw new Error('Max retries exceeded for createPrediction');
  }

  private async pollPrediction(predictionId: string): Promise<EachLabsPrediction> {
    const start = Date.now();
    while (true) {
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        throw new Error(`Prediction ${predictionId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
      }
      await sleep(POLL_INTERVAL_MS);

      const resp = await fetch(`${API_BASE_URL}/v1/prediction/${predictionId}`, {
        headers: this.headers,
      });
      if (!resp.ok) {
        throw new Error(`Status check ${resp.status}: ${await resp.text()}`);
      }
      const data = (await resp.json()) as EachLabsPrediction;
      if (data.status === 'success' || data.status === 'failed' || data.status === 'cancelled') {
        return data;
      }
    }
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

interface EachLabsPrediction {
  status: string;
  output?: string | string[];
  id?: string;
  logs?: string;
}

function pickOutputUrl(output: string | string[] | undefined): string | undefined {
  if (!output) return undefined;
  return Array.isArray(output) ? output[0] : output;
}
