# fastlane-nb-screenshot-localizer

Localize App Store screenshots in `fastlane/` to every locale defined under
`metadata/`, using Google's **Nano Banana** image-edit models. Translates the
text inside each English source screenshot (including the text inside the
phone-screen mockup) and preserves the original layout, fonts, and visual
style.

Supports two backends:

- **eachlabs.ai** — `nano-banana-2-edit` and `nano-banana-pro-edit`
- **fal.ai** — `fal-ai/nano-banana-2/edit` and `fal-ai/nano-banana-pro/edit`

A JSON ledger tracks the SHA-256 of each English source so unchanged files
are skipped on re-runs. Locales handled by a designer can be marked as
`--manual` so they're recorded in the ledger and skipped by the API.

## Install

```bash
# one-shot via npx
npx fastlane-nb-screenshot-localizer --dry-run

# or install globally
npm i -g fastlane-nb-screenshot-localizer
```

Requires Node 18+ (uses built-in `fetch`).

## Layout it expects

Run from your project root. The tool auto-detects either:

```
<project>/fastlane/metadata/
<project>/fastlane/screenshots/en-US/...
```

or:

```
<project>/ios/fastlane/metadata/
<project>/ios/fastlane/screenshots/en-US/...
```

Override with `--fastlane-dir <path>`.

## Quick start

```bash
# eachlabs (env-var auth)
export EACHLABS_API_KEY=...
fastlane-nb-screenshot-localizer

# fal.ai (env-var auth)
export FAL_KEY=...
fastlane-nb-screenshot-localizer

# inline keys (the flag itself selects the provider)
fastlane-nb-screenshot-localizer --each-api-key=... --pro
fastlane-nb-screenshot-localizer --fal-api-key=...
```

## Provider selection

| Situation | Provider used |
|---|---|
| `--each-api-key <key>` passed | eachlabs (with given key) |
| `--fal-api-key <key>` passed | fal (with given key) |
| both inline flags passed | error |
| only `EACHLABS_API_KEY` in env | eachlabs |
| only `FAL_KEY` in env | fal |
| both env vars set | eachlabs (preferred) |
| neither | error |

## Flags

| Flag | Purpose |
|---|---|
| `--pro` | Use the pro variant on the chosen provider (`nano-banana-pro-edit` / `nano-banana-pro/edit`). |
| `--dry-run` | Show what would be done; no API calls. |
| `--locale <code>` | Process only this locale (repeatable). |
| `--force` | Ignore the ledger; redo everything. |
| `--sequential` | One locale at a time (defaults to parallel). |
| `--rate-limit <rpm>` | Provider-wide rate limit. Default: 10. |
| `--manual <code>` | Mark a locale as designer-provided (repeatable). Skips API and copy phases; records existing screenshots in the ledger. |
| `--people` | Adapt photographic people in the screenshot to the target locale. Affects only `ar-SA`, `es-MX`, `hi`, `id`, `ja`, `ko`, `ms`, `pt-BR`, `th`, `tr`, `vi`, `zh-Hans`, `zh-Hant`. Tracked as a separate ledger variant, so toggling regenerates only those locales. |
| `--keep <term>` | Proper noun or brand name to leave untranslated (repeatable). Useful for app names, product names, or any term that should pass through verbatim. |
| `--each-api-key <key>` | Use eachlabs with this key. |
| `--fal-api-key <key>` | Use fal.ai with this key. |
| `--fastlane-dir <path>` | Override fastlane-dir auto-detection. |
| `--path <dir>` | Override the screenshots directory (relative to cwd). Defaults to `<fastlane-dir>/screenshots`. |
| `--context-file <path>` | Override path to the app-specific rules file (relative to cwd). Defaults to `.context/ss_localization.md`. |
| `--verbose` | Extra logging. |

## App-specific prompt rules

The built-in localization prompt is intentionally generic — it knows nothing about your app, its product names, its tone, or its UI vocabulary. If you want extra rules layered on top (don't translate certain product names, enforce a tone, preserve custom UI strings, force a specific verb form, etc.), drop them into a markdown file and they'll be appended verbatim to every localization prompt.

- Default location: `.context/ss_localization.md` under the directory you run the CLI from.
- Override with `--context-file <path>`.
- If the default file is missing, the tool runs as before. If you pass `--context-file` and the file is missing, the run errors out.

Example `.context/ss_localization.md`:

```markdown
- The product name is "MyApp Pro" — never translate it, never abbreviate it.
- The hero headline must always start with a verb in the imperative mood.
- Treat the word "Streak" as a feature name; keep the English spelling.
- For Japanese specifically, use polite-form (です/ます) verbs.
```

The contents are appended verbatim under an `Additional app-specific rules:` heading at the end of the prompt sent to the model. Keep it concise — the prompt window is finite, and every line costs tokens on every screenshot.

## Cost

Pricing is provider-agnostic and depends only on the variant:

| Variant | Price/image |
|---|---|
| Standard | $0.08 |
| Pro | $0.15 |

A `--dry-run` cost line previews the spend before you commit.

## How the ledger works

`<screenshots>/.localization-ledger.json` records, per `(locale, file)`:

- the SHA-256 of the English source it was generated from
- generation timestamp
- the prediction id (or `"copy"` / `"manual"` for non-API rows)
- a `variant` (`"default"` or `"people"`) so toggling `--people` regenerates only the affected locales

Touch the English source → its hash changes → the corresponding row is regenerated next run.

## License

MIT
