export type ProviderName = 'eachlabs' | 'fal';

export type Variant = 'standard' | 'pro';

export interface ProviderRequest {
  imageBuffer: Buffer;
  mimeType: string;
  prompt: string;
}

export interface ProviderResult {
  outputBuffer: Buffer;
  predictionId: string;
}

export interface Provider {
  readonly name: ProviderName;
  readonly variant: Variant;
  readonly pricePerImage: number;
  translate(req: ProviderRequest): Promise<ProviderResult>;
}

export interface ProviderFactoryOpts {
  name: ProviderName;
  apiKey: string;
  pro: boolean;
  rateLimitRpm: number;
}

export type LedgerVariant = 'default' | 'people';

export interface LedgerTargetEntry {
  source_hash: string;
  generated_at: string;
  prediction_id: string;
  variant: LedgerVariant;
}

export interface LedgerData {
  version: number;
  sources: Record<string, unknown>;
  targets: Record<string, Record<string, LedgerTargetEntry>>;
}
