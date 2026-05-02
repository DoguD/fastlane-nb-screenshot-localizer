#!/usr/bin/env node
import { resolve } from 'node:path';
import { Command, Option } from 'commander';
import { runLocalizer, resolveFastlaneDir, type LocalizerOptions } from './localizer.js';
import type { ProviderName } from './types.js';

interface RawOpts {
  pro: boolean;
  dryRun: boolean;
  locale?: string[];
  force: boolean;
  sequential: boolean;
  rateLimit: string;
  manual?: string[];
  people: boolean;
  keep?: string[];
  eachApiKey?: string;
  falApiKey?: string;
  fastlaneDir?: string;
  path?: string;
  verbose: boolean;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('fastlane-nb-screenshot-localizer')
    .description(
      'Localize App Store screenshots in fastlane/ via Nano Banana edit models. ' +
        'Supports eachlabs.ai and fal.ai providers.',
    )
    .version('0.3.1')
    .option('--pro', 'Use the pro model variant on the chosen provider', false)
    .option('--dry-run', 'Preview without making API calls or writing files', false)
    .option(
      '--locale <code>',
      'Restrict to this locale (repeatable)',
      collect,
      [] as string[],
    )
    .option('--force', 'Ignore the ledger; redo all', false)
    .option('--sequential', 'Process locales one at a time', false)
    .option('--rate-limit <rpm>', 'Max requests per minute', '10')
    .option(
      '--manual <code>',
      'Mark this locale as designer-provided (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--people',
      'Adapt people in the screenshot to the target locale ' +
        '(only ar-SA, es-MX, id, ja, ko, pt-BR, th, tr, vi, zh-Hans). ' +
        'Tracked as a separate ledger variant.',
      false,
    )
    .option(
      '--keep <term>',
      'Proper noun / brand name to leave untranslated (repeatable)',
      collect,
      [] as string[],
    )
    .option('--each-api-key <key>', 'Use eachlabs with this key (selects eachlabs)')
    .option('--fal-api-key <key>', 'Use fal.ai with this key (selects fal)')
    .option('--fastlane-dir <path>', 'Override fastlane-dir auto-detection')
    .option(
      '--path <dir>',
      'Override screenshots directory (relative to cwd). Defaults to <fastlane-dir>/screenshots.',
    )
    .option('--verbose', 'Extra logging', false);

  program.parse(process.argv);
  const opts = program.opts<RawOpts>();

  const provider = resolveProvider(opts);

  const fastlaneDir = resolveFastlaneDir(process.cwd(), opts.fastlaneDir);
  const rateLimitRpm = parseInt(opts.rateLimit, 10);
  if (!Number.isFinite(rateLimitRpm) || rateLimitRpm <= 0) {
    fail(`--rate-limit must be a positive integer (got "${opts.rateLimit}")`);
  }

  const screenshotsDir = opts.path ? resolve(opts.path) : undefined;

  const options: LocalizerOptions = {
    fastlaneDir,
    screenshotsDir,
    providerName: provider.name,
    apiKey: provider.apiKey,
    pro: opts.pro,
    dryRun: opts.dryRun,
    force: opts.force,
    sequential: opts.sequential,
    rateLimitRpm,
    targetLocales: opts.locale && opts.locale.length > 0 ? opts.locale : null,
    manualLocales: new Set(opts.manual ?? []),
    people: opts.people,
    keepTerms: opts.keep ?? [],
    verbose: opts.verbose,
  };

  await runLocalizer(options);
}

function resolveProvider(opts: RawOpts): { name: ProviderName; apiKey: string } {
  const eachKey = opts.eachApiKey?.trim();
  const falKey = opts.falApiKey?.trim();

  if (eachKey && falKey) {
    fail('Pass only one of --each-api-key or --fal-api-key, not both.');
  }
  if (eachKey) return { name: 'eachlabs', apiKey: eachKey };
  if (falKey) return { name: 'fal', apiKey: falKey };

  // Dry-run path: even with no env keys, allow a placeholder so users can
  // preview without holding a key.
  const envEach = process.env.EACHLABS_API_KEY?.trim();
  const envFal = process.env.FAL_KEY?.trim();

  if (envEach && envFal) {
    // Both env vars set — prefer eachlabs (per design decision).
    return { name: 'eachlabs', apiKey: envEach };
  }
  if (envEach) return { name: 'eachlabs', apiKey: envEach };
  if (envFal) return { name: 'fal', apiKey: envFal };

  fail(
    'No API key found. Pass --each-api-key=<key> or --fal-api-key=<key>, ' +
      'or set EACHLABS_API_KEY or FAL_KEY in the environment.',
  );
}

function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
