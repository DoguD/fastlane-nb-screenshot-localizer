import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { AsyncMutex } from './concurrency.js';
import type { LedgerData, LedgerTargetEntry, LedgerVariant } from './types.js';

export class Ledger {
  private data: LedgerData = { version: 1, sources: {}, targets: {} };
  private readonly mutex = new AsyncMutex();

  constructor(private readonly path: string) {}

  async load(): Promise<this> {
    if (existsSync(this.path)) {
      const raw = await readFile(this.path, 'utf-8');
      this.data = JSON.parse(raw);
      if (!this.data.targets) this.data.targets = {};
      if (!this.data.sources) this.data.sources = {};
      if (!this.data.version) this.data.version = 1;
    }
    return this;
  }

  async save(): Promise<void> {
    await this.mutex.run(async () => {
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2));
      await rename(tmp, this.path);
    });
  }

  isUpToDate(
    sourceFile: string,
    targetLocale: string,
    currentHash: string,
    variant: LedgerVariant = 'default',
  ): boolean {
    const target = this.data.targets[targetLocale]?.[sourceFile];
    if (!target) return false;
    if (target.source_hash !== currentHash) return false;
    return (target.variant ?? 'default') === variant;
  }

  getManualLocales(): Set<string> {
    const out = new Set<string>();
    for (const [locale, entries] of Object.entries(this.data.targets)) {
      for (const entry of Object.values(entries)) {
        if (entry.prediction_id === 'manual') {
          out.add(locale);
          break;
        }
      }
    }
    return out;
  }

  record(
    sourceFile: string,
    targetLocale: string,
    sourceHash: string,
    predictionId: string,
    variant: LedgerVariant = 'default',
  ): void {
    this.writeEntry(sourceFile, targetLocale, {
      source_hash: sourceHash,
      generated_at: new Date().toISOString(),
      prediction_id: predictionId,
      variant,
    });
  }

  recordCopy(
    sourceFile: string,
    targetLocale: string,
    sourceHash: string,
    variant: LedgerVariant = 'default',
  ): void {
    this.writeEntry(sourceFile, targetLocale, {
      source_hash: sourceHash,
      generated_at: new Date().toISOString(),
      prediction_id: 'copy',
      variant,
    });
  }

  recordManual(
    sourceFile: string,
    targetLocale: string,
    sourceHash: string,
    variant: LedgerVariant = 'default',
  ): void {
    this.writeEntry(sourceFile, targetLocale, {
      source_hash: sourceHash,
      generated_at: new Date().toISOString(),
      prediction_id: 'manual',
      variant,
    });
  }

  private writeEntry(sourceFile: string, targetLocale: string, entry: LedgerTargetEntry): void {
    const localeEntries = (this.data.targets[targetLocale] ??= {});
    localeEntries[sourceFile] = entry;
  }
}
