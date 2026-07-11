---
name: translate
description: Fill missing i18n translations in the Lingui .po catalogs cheaply — extract every empty msgstr, fan out chunked jobs to Haiku subagents (model override, not the main model), merge results back deterministically, and verify zero remain. Produces filled packages/locale/locales/*/*.po. Use when the user asks to translate/fill missing translations, run "pnpm translate" cheaply, or after adding new UI strings. Do not use to add or mark new strings (that is lingui:extract in code) or to change the locale list — use the i18n-lingui-system rule.
---

# translate — fill missing .po translations with a cheap model

Replaces `pnpm translate` (which would run every string through the main model).
Instead: a deterministic script finds every empty `msgstr`, chunks them into
jobs, **Haiku subagents** translate the chunks (invoked with `model: "haiku"` so
the expensive main model only orchestrates), and a deterministic merge script
writes them back — no model in the write path. Input → output: empty `msgstr` in
`packages/locale/locales/{locale}/{erp,mes}.po` → filled `msgstr`.

**Announce at start:** "Using the translate skill — filling missing .po translations via Haiku subagents."

Scope: all target locales at once (supportedLanguages minus source `en`; orphaned
`nl` is excluded automatically). Never overwrites an existing translation — only
empty `msgstr` are touched.

## Step 1 — Extract missing translations into chunked jobs

```bash
pnpm run lingui:extract                                   # refresh catalogs from source strings
node .ai/skills/translate/scripts/extract-missing.mjs     # scan → chunk jobs
```

Read the printed summary. It prints total missing, chunk count, and per-locale
counts, then writes `.ai/scratch/translate/manifest.json` plus one input file per
chunk under `.ai/scratch/translate/in/`.

- If the output contains `NOTHING_TO_TRANSLATE` → **STOP**, report "no missing
  translations", skip to nothing. Do not run later steps.

## Step 2 — Start the live progress watcher, then fan out subagents

First launch the background watcher **once** — it ticks every 10s independently of
the main loop (so it keeps reporting even while a batch of subagents is in
flight). Use the `Bash` tool with `run_in_background: true`:

```bash
node .ai/skills/translate/scripts/progress.mjs --watch
```

It reports `chunks done/total · strings done/total (%)` with a per-locale
breakdown, updating as each subagent writes its `out/` file. (Tune cadence with
`TRANSLATE_PROGRESS_INTERVAL=5` seconds if the user wants faster ticks.) It stops
itself when Step 5 writes the `.done` marker.

Then read `.ai/scratch/translate/manifest.json` — an array of
`{ chunk, in, out, locale, catalog, langLabel, count }`.

For **every** entry, dispatch an `Agent` with **`model: "haiku"`**. Dispatch in
batches of **up to 10 Agent calls per message** (multiple tool_use blocks in one
message) so they run concurrently. **After each batch returns, run a one-shot
snapshot** so progress is visible inline even if the background watcher output
isn't surfaced:

```bash
node .ai/skills/translate/scripts/progress.mjs
```

Then send the next batch. Use this exact prompt, substituting the entry's `in`
and `out` absolute paths:

````text
You are a professional software-localization translator for a manufacturing ERP.

Read the input file (JSON) at this absolute path:
<manifest entry `in`>

It is: { "locale", "langLabel", "catalog", "items": [ { "msgid", "note?" } ] }.
Translate every item's `msgid` from English into the language named by `langLabel`.

RULES — follow exactly:
1. Preserve every placeholder EXACTLY: `{0}`, `{name}`, `{count}`, etc. Never
   translate, rename, reorder-away, or drop a placeholder token.
2. For ICU syntax like `{0, plural, one {…} other {…}}`, keep the structure,
   keywords (`plural`, `select`, `one`, `other`, `=0`, `#`) and braces intact;
   translate ONLY the human words inside each `{…}` branch.
3. Preserve leading/trailing spaces, capitalization intent, and punctuation.
4. Do NOT translate brand names, code identifiers, or placeholder variable names.
5. Use `note` only as context for a placeholder; never include it in the output.

OUTPUT — write ONLY a JSON object (create/overwrite) to this absolute path:
<manifest entry `out`>

It maps each input `msgid` (exact original English key, unchanged) to its
translation, e.g. { "Add parts": "Ajouter des pièces", "{0} days": "{0} jours" }.
Every input item must be a key. No commentary. Then reply only: DONE.
````

Do **NOT** trust the subagent's reply count — a subagent may misreport how many
it wrote. The merge script in Step 3 is the source of truth for completeness.

## Step 3 — Merge deterministically and verify

```bash
node .ai/skills/translate/scripts/merge-translations.mjs
```

Read its output:
- `Merged: N filled, M unmatched` — `unmatched` means the model returned a key
  that no longer matches an empty `msgid` (usually the model altered the key);
  those are skipped safely.
- `Remaining empty msgstr in targeted catalogs: R`.
- `Missing/invalid chunk outputs` — chunks whose `out` file is absent or bad JSON.

## Step 4 — Retry until dry (max 3 rounds total)

| Situation | Action |
|-----------|--------|
| `Remaining` is `0` | Go to Step 5. |
| `Remaining > 0` and rounds so far `< 3` | Re-run Step 1's `extract-missing.mjs` only (NOT `lingui:extract` again) — it regenerates jobs for just the still-empty entries — then redo the **subagent dispatch + snapshot + merge** (Step 2's fan-out and Step 3). Do **not** relaunch the watcher — the one from Step 2 keeps running and re-reads the new manifest. Each round shrinks. |
| `Remaining > 0` after 3 rounds | **STOP.** Report the residual count and the locales still short; do not loop further. |

If a whole locale keeps failing, lower the chunk size and retry that round:
`TRANSLATE_CHUNK_SIZE=15 node .ai/skills/translate/scripts/extract-missing.mjs`.

## Step 5 — Normalize and report

```bash
touch .ai/scratch/translate/.done     # stops the background progress watcher
pnpm run lingui:clean                 # strip POT date + origin churn (same as pnpm translate)
```

Do **not** run `lingui:compile` — `.mjs` are gitignored build artifacts, produced
at build time.

## Step 6 — Verify nothing is left

```bash
pnpm exec linguito check      # exits 0 = clean; non-zero = still-missing entries
```

This is the same missing-translation check `pnpm translate` runs, **without** the
LLM step — do NOT run `pnpm translate` itself here (it would re-invoke an LLM).

| Result | Action |
|--------|--------|
| Exit 0 / "no missing" | Verified clean → Step 7. |
| Non-zero, lists entries | Those `msgstr` are still empty. If under the 3-round cap, go back to Step 4 (re-run `extract-missing.mjs` → dispatch → merge). Otherwise report the residual and STOP. |

Report: total filled, per-locale counts, any residual, and that the changed files
are `packages/locale/locales/*/*.po`.

## Step 7 — Clean up scratch (always, even on partial/failed runs)

```bash
rm -rf .ai/scratch/translate
```

Leaving `in/`, `out/`, and `manifest.json` behind risks a stale chunk merging on
the next run. (`extract-missing.mjs` also wipes this dir at the start of every
run, but clean up here too so the tree is tidy.)

## Output

Filled `msgstr` values in `packages/locale/locales/{locale}/{erp,mes}.po`. Commit
only if the user asks, via `/check-and-commit` (the `.po` files are the artifact;
`.mjs` stay gitignored). Scratch under `.ai/scratch/translate/` is disposable.

## Done when
- [ ] `node .ai/skills/translate/scripts/merge-translations.mjs` reports
      `Remaining empty msgstr ... : 0` (or the residual is reported after 3 rounds).
- [ ] `pnpm run lingui:clean` has run.
- [ ] `pnpm exec linguito check` exits 0 (or the residual is reported after 3 rounds).
- [ ] Only `msgstr` lines changed in the `.po` diff (no `msgid` touched):
      `git diff --no-color packages/locale/locales | grep -E '^\+' | grep -vE '^\+msgstr|^\+\+\+'` is empty.
- [ ] `.ai/scratch/translate` has been removed.

## Failure → action
| Symptom | Action |
|---------|--------|
| `extract-missing.mjs` errors reading config | Confirm `packages/locale/src/config.ts` still defines `supportedLanguages` + `languageNativeLabels`; the parser reads them by regex. |
| Merge shows many `unmatched` | The model rewrote keys. Re-run the round with smaller `TRANSLATE_CHUNK_SIZE`; unmatched entries stay empty and are retried next round. |
| A subagent dies / returns no file | That chunk's `out` is listed as missing; the next retry round re-dispatches only the still-empty entries. |
| `lingui:extract` produces huge unrelated diff | Expected on this branch; `lingui:clean` strips the date/origin churn. Real content changes are legitimate. |
