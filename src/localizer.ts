import { existsSync, mkdirSync } from 'node:fs';
import { copyFile, readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  COPY_FROM_SOURCE,
  LOCALE_LANGUAGES,
  LOCALE_PEOPLE_TRAITS,
  SHARED_LOCALES,
  SOURCE_LOCALE,
} from './locales.js';
import {
  fileSha256,
  getBufferDimensions,
  getImageDimensions,
  mimeForExt,
  resizeBufferTo,
  writeBuffer,
} from './image.js';
import { Ledger } from './ledger.js';
import { buildPrompt } from './prompts.js';
import { makeProvider } from './providers/index.js';
import type { LedgerVariant, Provider, ProviderName } from './types.js';

export interface LocalizerOptions {
  fastlaneDir: string;
  screenshotsDir?: string;
  providerName: ProviderName;
  apiKey: string;
  pro: boolean;
  dryRun: boolean;
  force: boolean;
  sequential: boolean;
  rateLimitRpm: number;
  targetLocales: string[] | null;
  indexFilter: number[] | null;
  manualLocales: Set<string>;
  people: boolean;
  keepTerms: string[];
  appContext?: string;
  verbose: boolean;
}

interface SourceInfo {
  name: string;
  path: string;
  hash: string;
  width: number;
  height: number;
  mimeType: string;
}

class Stats {
  private counts: Record<string, number> = {
    skipped: 0,
    generated: 0,
    copied: 0,
    manual: 0,
    failed: 0,
  };

  increment(key: keyof typeof this.counts | string): void {
    this.counts[key] = (this.counts[key] ?? 0) + 1;
  }

  summary(): Record<string, number> {
    return { ...this.counts };
  }
}

class Progress {
  done = 0;
  constructor(public readonly total: number) {}
  increment(): number {
    return ++this.done;
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

export async function runLocalizer(opts: LocalizerOptions): Promise<void> {
  const screenshotsDir = opts.screenshotsDir ?? join(opts.fastlaneDir, 'screenshots');
  const metadataDir = join(opts.fastlaneDir, 'metadata');
  const ledgerPath = join(screenshotsDir, '.localization-ledger.json');

  if (!existsSync(metadataDir)) {
    throw new Error(`metadata directory not found at ${metadataDir}`);
  }

  const allSources = await discoverSources(screenshotsDir);
  const sources = applyIndexFilter(allSources, opts.indexFilter);
  const allLocales = await discoverLocales(metadataDir, opts.targetLocales);
  const ledger = await new Ledger(ledgerPath).load();

  const explicitManualLocales = opts.manualLocales;
  const ledgerManualLocales = ledger.getManualLocales();
  const effectiveManualLocales = new Set<string>([
    ...explicitManualLocales,
    ...ledgerManualLocales,
  ]);

  const provider = opts.dryRun
    ? null
    : makeProvider({
        name: opts.providerName,
        apiKey: opts.apiKey,
        pro: opts.pro,
        rateLimitRpm: opts.rateLimitRpm,
      });

  const stats = new Stats();

  const modelSlug = opts.pro
    ? opts.providerName === 'fal'
      ? 'fal-ai/nano-banana-pro/edit'
      : 'nano-banana-pro-edit'
    : opts.providerName === 'fal'
      ? 'fal-ai/nano-banana/edit'
      : 'nano-banana-2-edit';
  const pricePerImage = opts.pro ? 0.15 : 0.08;

  console.log(`Provider: ${opts.providerName}`);
  console.log(`Model:    ${modelSlug}`);
  const sourceSuffix =
    opts.indexFilter !== null
      ? ` (filtered by --index ${opts.indexFilter.join(',')} from ${allSources.length} total)`
      : '';
  console.log(`Source:   ${sources.length} screenshots in ${SOURCE_LOCALE}/${sourceSuffix}`);
  console.log(`Target:   ${allLocales.length} locales`);
  if (opts.people) {
    const peopleLocales = allLocales.filter((l) => l in LOCALE_PEOPLE_TRAITS);
    const list =
      peopleLocales.length > 0
        ? peopleLocales.join(', ')
        : '(none of the selected locales qualify)';
    console.log(`People swap enabled for: ${list}`);
  }
  const autoProtected = [...ledgerManualLocales]
    .filter((l) => !explicitManualLocales.has(l))
    .sort();
  if (autoProtected.length > 0) {
    console.log(`Auto-protected manual locales (from ledger): ${autoProtected.join(', ')}`);
  }
  console.log();

  // Bucket locales
  let copyLocales = allLocales.filter((l) => COPY_FROM_SOURCE.includes(l));
  let generateLocales = allLocales.filter(
    (l) => l in LOCALE_LANGUAGES && !COPY_FROM_SOURCE.includes(l),
  );
  let sharedCopyPairs: Array<[string, string]> = [];
  for (const [primary, copies] of Object.entries(SHARED_LOCALES)) {
    for (const copyLocale of copies) {
      if (allLocales.includes(copyLocale)) {
        sharedCopyPairs.push([primary, copyLocale]);
      }
    }
  }
  const sharedTargets = new Set(sharedCopyPairs.map(([, c]) => c));
  generateLocales = generateLocales.filter((l) => !sharedTargets.has(l));

  // Manual locales bypass other phases
  if (effectiveManualLocales.size > 0) {
    copyLocales = copyLocales.filter((l) => !effectiveManualLocales.has(l));
    generateLocales = generateLocales.filter((l) => !effectiveManualLocales.has(l));
    sharedCopyPairs = sharedCopyPairs.filter(([, c]) => !effectiveManualLocales.has(c));
  }

  // Phase 0: manual marks
  if (opts.manualLocales.size > 0) {
    const sortedManual = [...opts.manualLocales].sort();
    console.log(`Marking manual locales: ${sortedManual.join(', ')}`);
    for (const locale of sortedManual) {
      await markLocaleManual({
        locale,
        sources,
        screenshotsDir,
        ledger,
        stats,
        people: opts.people,
        dryRun: opts.dryRun,
      });
    }
    console.log();
  }

  // Phase 1: English copy
  if (copyLocales.length > 0) {
    console.log(`Copying English screenshots to: ${copyLocales.join(', ')}`);
    for (const locale of copyLocales) {
      await copyScreenshots({
        fromLocale: SOURCE_LOCALE,
        toLocale: locale,
        sources,
        screenshotsDir,
        ledger,
        stats,
        people: opts.people,
        dryRun: opts.dryRun,
        force: opts.force,
      });
    }
    console.log();
  }

  // Phase 2: API generation
  if (generateLocales.length > 0) {
    const perLocaleCounts = new Map<string, number>();
    for (const locale of generateLocales) {
      const variant = variantFor(locale, opts.people);
      const targetDir = join(screenshotsDir, locale);
      let n = 0;
      for (const source of sources) {
        const upToDate =
          !opts.force &&
          ledger.isUpToDate(source.name, locale, source.hash, variant) &&
          existsSync(join(targetDir, source.name));
        if (!upToDate) n++;
      }
      perLocaleCounts.set(locale, n);
    }

    const totalToGenerate = [...perLocaleCounts.values()].reduce((a, b) => a + b, 0);
    const localeWidth = Math.max(...generateLocales.map((l) => l.length));

    console.log('Pre-flight (Phase 2 — API generation):');
    for (const locale of generateLocales) {
      const n = perLocaleCounts.get(locale) ?? 0;
      const padded = locale.padEnd(localeWidth);
      if (n === 0) {
        console.log(`  ${padded}  0 screenshots          (all up to date)`);
      } else {
        const cost = n * pricePerImage;
        console.log(
          `  ${padded}  ${n} screenshots × $${pricePerImage.toFixed(2)} = $${cost.toFixed(2)}`,
        );
      }
    }
    const totalCost = totalToGenerate * pricePerImage;
    console.log(
      `Total: ${totalToGenerate} screenshots across ${generateLocales.length} locales = $${totalCost.toFixed(2)}`,
    );
    console.log();

    const needsPrompt = totalToGenerate > 0 && !opts.dryRun && process.stdin.isTTY;
    if (needsPrompt) {
      const ok = await confirm('Proceed? [y/N] ');
      console.log();
      if (!ok) {
        console.log('Aborted by user.');
        return;
      }
    }

    const totalGenerate = generateLocales.length * sources.length;
    const progress = new Progress(totalGenerate);
    const mode = opts.sequential ? 'sequentially' : 'in parallel';
    console.log(`Generating across ${generateLocales.length} locales ${mode}`);
    console.log();

    const work = generateLocales.map((locale) => async () => {
      await processLocale({
        locale,
        sources,
        provider,
        screenshotsDir,
        ledger,
        stats,
        progress,
        people: opts.people,
        keepTerms: opts.keepTerms,
        appContext: opts.appContext,
        dryRun: opts.dryRun,
        force: opts.force,
        verbose: opts.verbose,
      });
    });

    if (opts.sequential) {
      for (const fn of work) await fn();
    } else {
      const settled = await Promise.allSettled(work.map((fn) => fn()));
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`  ERROR: locale ${generateLocales[i]} crashed: ${r.reason}`);
        }
      });
    }
  }

  // Phase 3: Shared copies (fr-FR → fr-CA)
  if (sharedCopyPairs.length > 0) {
    console.log();
    for (const [primary, copyLocale] of sharedCopyPairs) {
      console.log(`Copying ${primary} screenshots to ${copyLocale}`);
      await copyScreenshots({
        fromLocale: primary,
        toLocale: copyLocale,
        sources,
        screenshotsDir,
        ledger,
        stats,
        people: opts.people,
        dryRun: opts.dryRun,
        force: opts.force,
      });
    }
  }

  // Summary
  const s = stats.summary();
  console.log();
  console.log('--- Summary ---');
  console.log(`  Generated: ${s.generated ?? 0}`);
  console.log(`  Copied:    ${s.copied ?? 0}`);
  console.log(`  Manual:    ${s.manual ?? 0}`);
  console.log(`  Skipped:   ${s.skipped ?? 0}`);
  console.log(`  Failed:    ${s.failed ?? 0}`);
}

// ---------------------------------------------------------------------------
// Discovery + setup
// ---------------------------------------------------------------------------

export function resolveFastlaneDir(cwd: string, override?: string): string {
  if (override) {
    const abs = resolve(override);
    if (existsSync(join(abs, 'metadata'))) return abs;
    throw new Error(`--fastlane-dir ${override} has no metadata/ subdir`);
  }
  const candidates = [join(cwd, 'fastlane'), join(cwd, 'ios', 'fastlane')];
  for (const c of candidates) {
    if (existsSync(join(c, 'metadata'))) return c;
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `Could not find fastlane/metadata under ${cwd} or ${cwd}/ios. Pass --fastlane-dir.`,
  );
}

async function discoverSources(screenshotsDir: string): Promise<SourceInfo[]> {
  const sourceDir = join(screenshotsDir, SOURCE_LOCALE);
  if (!existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }
  const entries = (await readdir(sourceDir)).sort();
  const out: SourceInfo[] = [];
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') continue;
    const path = join(sourceDir, name);
    const st = await stat(path);
    if (!st.isFile()) continue;
    const hash = await fileSha256(path);
    const dims = await getImageDimensions(path);
    out.push({
      name,
      path,
      hash,
      width: dims.width,
      height: dims.height,
      mimeType: mimeForExt(ext),
    });
  }
  if (out.length === 0) {
    throw new Error(`No screenshots found in ${sourceDir}`);
  }
  return out;
}

async function discoverLocales(
  metadataDir: string,
  filter: string[] | null,
): Promise<string[]> {
  const all = new Set<string>();
  const entries = await readdir(metadataDir);
  for (const name of entries) {
    if (name === SOURCE_LOCALE) continue;
    const path = join(metadataDir, name);
    const st = await stat(path);
    if (st.isDirectory()) all.add(name);
  }
  let result = [...all];
  if (filter && filter.length > 0) {
    const filterSet = new Set(filter);
    result = result.filter((l) => filterSet.has(l));
  }
  return result.sort();
}

function variantFor(locale: string, people: boolean): LedgerVariant {
  return people && locale in LOCALE_PEOPLE_TRAITS ? 'people' : 'default';
}

function applyIndexFilter(
  sources: SourceInfo[],
  indexFilter: number[] | null,
): SourceInfo[] {
  if (indexFilter === null) return sources;
  const wanted = new Set(indexFilter);
  const matched = new Set<number>();
  const filtered: SourceInfo[] = [];
  for (const source of sources) {
    const m = /^(\d+)/.exec(source.name);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    if (wanted.has(idx)) {
      matched.add(idx);
      filtered.push(source);
    }
  }
  const unmatched = indexFilter.filter((i) => !matched.has(i));
  if (unmatched.length > 0) {
    console.log(
      `WARNING: --index value(s) matched no source filenames: ${unmatched.join(', ')}`,
    );
  }
  if (filtered.length === 0) {
    throw new Error(
      `No screenshots match --index ${indexFilter.join(',')} ` +
        `(source filenames must start with one of these integers).`,
    );
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Phase implementations
// ---------------------------------------------------------------------------

interface CopyArgs {
  fromLocale: string;
  toLocale: string;
  sources: SourceInfo[];
  screenshotsDir: string;
  ledger: Ledger;
  stats: Stats;
  people: boolean;
  dryRun: boolean;
  force: boolean;
}

async function copyScreenshots(args: CopyArgs): Promise<void> {
  const fromDir = join(args.screenshotsDir, args.fromLocale);
  const toDir = join(args.screenshotsDir, args.toLocale);
  const variant = variantFor(args.toLocale, args.people);

  if (!existsSync(fromDir)) {
    if (args.dryRun) {
      for (const s of args.sources) {
        console.log(
          `  [DRY RUN] Would copy ${args.fromLocale}/${s.name} -> ${args.toLocale}/${s.name}`,
        );
      }
      return;
    }
    console.log(`  WARNING: ${fromDir} does not exist, skipping copy to ${args.toLocale}`);
    return;
  }
  if (!args.dryRun) mkdirSync(toDir, { recursive: true });

  for (const source of args.sources) {
    if (
      !args.force &&
      args.ledger.isUpToDate(source.name, args.toLocale, source.hash, variant)
    ) {
      if (existsSync(join(toDir, source.name))) {
        args.stats.increment('skipped');
        continue;
      }
    }

    const fromFile = join(fromDir, source.name);
    if (!existsSync(fromFile)) {
      console.log(`  WARNING: Missing ${source.name} in ${args.fromLocale}, skipping`);
      continue;
    }

    if (args.dryRun) {
      console.log(`  [DRY RUN] Copy ${args.fromLocale}/${source.name} -> ${args.toLocale}/${source.name}`);
      continue;
    }

    await copyFile(fromFile, join(toDir, source.name));
    args.ledger.recordCopy(source.name, args.toLocale, source.hash, variant);
    await args.ledger.save();
    args.stats.increment('copied');
  }
}

interface ProcessLocaleArgs {
  locale: string;
  sources: SourceInfo[];
  provider: Provider | null;
  screenshotsDir: string;
  ledger: Ledger;
  stats: Stats;
  progress: Progress;
  people: boolean;
  keepTerms: string[];
  appContext?: string;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
}

async function processLocale(args: ProcessLocaleArgs): Promise<void> {
  const language = LOCALE_LANGUAGES[args.locale];
  if (!language) {
    console.log(`  WARNING: No language mapping for locale ${args.locale}, skipping`);
    return;
  }

  const targetDir = join(args.screenshotsDir, args.locale);
  if (!args.dryRun) mkdirSync(targetDir, { recursive: true });
  const peopleTraits = args.people ? LOCALE_PEOPLE_TRAITS[args.locale] ?? null : null;
  const prompt = buildPrompt({
    language,
    localeCode: args.locale,
    peopleTraits,
    keepTerms: args.keepTerms,
    appContext: args.appContext,
  });
  if (args.verbose) {
    console.log(`  [${args.locale}] prompt (${prompt.length} chars):`);
    console.log(prompt.replace(/^/gm, '    '));
  }
  const variant = variantFor(args.locale, args.people);

  for (const source of args.sources) {
    if (
      !args.force &&
      args.ledger.isUpToDate(source.name, args.locale, source.hash, variant)
    ) {
      if (existsSync(join(targetDir, source.name))) {
        const n = args.progress.increment();
        console.log(
          `  [${n}/${args.progress.total}] ${args.locale}: ${source.name} ... skipped (up to date)`,
        );
        args.stats.increment('skipped');
        continue;
      }
    }

    const n = args.progress.increment();

    if (args.dryRun) {
      console.log(
        `  [${n}/${args.progress.total}] ${args.locale}: ${source.name} ... [DRY RUN] would generate`,
      );
      continue;
    }

    if (!args.provider) throw new Error('Provider missing in non-dry-run mode');

    console.log(
      `  [${n}/${args.progress.total}] ${args.locale}: ${source.name} ... submitting`,
    );
    const start = Date.now();

    try {
      const imageBuffer = await readFile(source.path);
      const { outputBuffer, predictionId } = await args.provider.translate({
        imageBuffer,
        mimeType: source.mimeType,
        prompt,
      });

      const dest = join(targetDir, source.name);
      const outDims = await getBufferDimensions(outputBuffer);
      if (outDims.width !== source.width || outDims.height !== source.height) {
        await resizeBufferTo(outputBuffer, source.width, source.height, dest);
      } else {
        await writeBuffer(dest, outputBuffer);
      }

      args.ledger.record(source.name, args.locale, source.hash, predictionId, variant);
      await args.ledger.save();

      const elapsed = (Date.now() - start) / 1000;
      console.log(
        `  [${n}/${args.progress.total}] ${args.locale}: ${source.name} ... done (${elapsed.toFixed(1)}s)`,
      );
      args.stats.increment('generated');
    } catch (err) {
      const elapsed = (Date.now() - start) / 1000;
      console.error(
        `  [${n}/${args.progress.total}] ${args.locale}: ${source.name} ... FAILED (${elapsed.toFixed(1)}s): ${(err as Error).message}`,
      );
      args.stats.increment('failed');
    }
  }
}

interface MarkManualArgs {
  locale: string;
  sources: SourceInfo[];
  screenshotsDir: string;
  ledger: Ledger;
  stats: Stats;
  people: boolean;
  dryRun: boolean;
}

async function markLocaleManual(args: MarkManualArgs): Promise<void> {
  const targetDir = join(args.screenshotsDir, args.locale);
  if (!existsSync(targetDir)) {
    console.log(`  WARNING: ${targetDir} does not exist; skipping manual mark for ${args.locale}`);
    return;
  }
  const variant = variantFor(args.locale, args.people);

  for (const source of args.sources) {
    if (!existsSync(join(targetDir, source.name))) {
      console.log(`  WARNING: ${args.locale}/${source.name} missing; skipping manual mark`);
      continue;
    }
    if (args.dryRun) {
      console.log(`  [DRY RUN] Mark ${args.locale}/${source.name} as manual`);
      continue;
    }
    args.ledger.recordManual(source.name, args.locale, source.hash, variant);
    await args.ledger.save();
    args.stats.increment('manual');
  }
}
