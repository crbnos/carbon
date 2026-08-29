---
name: translate
description: Fill missing i18n translations in the Lingui .po catalogs cheaply and CONSISTENTLY — extract every empty msgstr, attach the approved domain terminology from packages/locale/locales/glossary.json, fan out chunked jobs to Haiku subagents (model override, not the main model), merge results back deterministically, then verify none are missing AND none disagree on terminology. Produces filled packages/locale/locales/*/*.po. Use when the user asks to translate/fill missing translations, run "pnpm translate" cheaply, or after adding new UI strings. Do not use to add or mark new strings (that is lingui:extract in code) or to change the locale list — use the i18n-lingui-system rule.
---

# translate — fill missing .po translations with a cheap model

Replaces `pnpm translate` (which would run every string through the main model).
Instead: a deterministic script finds every empty `msgstr`, **attaches the
approved domain terms for that chunk**, chunks them into jobs, **Haiku
subagents** translate the chunks (invoked with `model: "haiku"` so the expensive
main model only orchestrates), and a deterministic merge script writes them back
— no model in the write path. Input → output: empty `msgstr` in
`packages/locale/locales/{locale}/{erp,mes}.po` → filled `msgstr`.

**Announce at start:** "Using the translate skill — filling missing .po translations via Haiku subagents, with the approved glossary attached."

Scope: all target locales at once (supportedLanguages minus source `en`; orphaned
`nl` is excluded automatically). Never overwrites an existing translation — only
empty `msgstr` are touched.

**One exception, and it overrides the scope above.** Repairing a locale whose
existing translations disagree with the glossary is a DIFFERENT job: it is
one locale per run, it skips `lingui:extract`, and repo-wide `linguito check` is
not a gate for it. That procedure is
`.ai/plans/2026-08-27-translation-consistency-runbook.md`, and it is
authoritative wherever it contradicts this file. Follow it end to end rather
than mixing the two — it calls back into this skill for the refill step only
(its Phase 3), after `reset-violations.mjs` has emptied the wrong entries.

## What this product is (the domain context every subagent gets)

Carbon is a manufacturing **ERP/MES/QMS** — it runs a machine shop end to end:
quoting, sales orders, purchasing, inventory and lot traceability, jobs on the
shop floor, quality records, and accounting. Its users are manufacturing
professionals, not general software users.

That matters because the everyday English word is usually the WRONG word. A
"Job" is a shop-floor work order, not employment. A "Receipt" is goods arriving
from a supplier, not a payment slip. An "Operation" is a routing step, not an
action. Translating these literally produces text that reads as machine output
to the customer who has to work in it all day. **Translate the way an ERP is
translated in that market, not the way a dictionary would.**

## The glossary is the thing that makes this consistent

`packages/locale/locales/glossary.json` — **448 domain terms**, each with its
English meaning and an approved translation per locale.

The variance problem this exists to fix: the fan-out translates chunks in
parallel, and every chunk used to decide terminology independently. That is how
Chinese ended up rendering "Job" six different ways across 165 strings. The
glossary removes the decision — subagents are handed the word, so they cannot
disagree.

Three rules that are easy to get wrong:

- **Blank means NOT YET APPROVED, never "translate freely."** A blank slot is
  passed to the subagent as `approved: null` alongside the English meaning, so
  it still gets domain context without being fed a wrong word.
- **`ambiguity` narrows a term to its domain sense only.** `Part` must not be
  fixed inside "part of"; `Make`/`Buy` are replenishment settings AND ordinary
  verbs; `Line` is a document row, never an address line. Violations on these
  are reported as *advisory* and never fail the gate.
- **`englishVariants` are the same word spelled differently** (`Cancelled`/
  `Canceled`, the three spellings of `Nonconformance`) and MUST share one
  translation. `seeAlso` is different — it links an abbreviation to its
  spelled-out form, and those are translated **independently**, because a
  language may keep `BOM` in Latin while translating "Bill of Materials".

## Glossary helper — do not write your own script

`glossary-lookup.mjs` answers terminology questions without pulling the 448-term
file into context:

```bash
node .claude/skills/translate/scripts/glossary-lookup.mjs --term Job --locale zh
node .claude/skills/translate/scripts/glossary-lookup.mjs --scan "Delete this job material?" --locale zh
node .claude/skills/translate/scripts/glossary-lookup.mjs --coverage
node .claude/skills/translate/scripts/glossary-lookup.mjs --list --locale zh --missing
```

Exit 0 = it is a domain term, 1 = it is not (so it can gate a shell step).
`--coverage` is the first thing to run when the user asks "how consistent are
we?" — it prints approved-term counts per locale.

Editing the glossary is NOT part of this skill. Filling a language's column is a
separate, reviewed decision — an unreviewed term list just makes a wrong word
consistent everywhere. If terms are missing, say so and stop.

## Step 1 — Extract missing translations into chunked jobs

```bash
pnpm run lingui:extract                                   # refresh catalogs from source strings
node .claude/skills/translate/scripts/extract-missing.mjs     # scan → chunk jobs
```

Read the printed summary. It prints total missing, chunk count, per-locale
counts, **and the glossary coverage for each locale**, then writes
`.ai/scratch/translate/manifest.json` plus one input file per chunk under
`.ai/scratch/translate/in/`. Each chunk file now carries `domain`, `glossary`
(only the terms appearing in that chunk's strings) and `doNotTranslate`.

- If the output contains `NOTHING_TO_TRANSLATE` → **STOP**, report "no missing
  translations", skip to nothing. Do not run later steps.
- If it prints `NO APPROVED TERMS YET` for a locale, that locale will be
  translated with domain context but no fixed vocabulary. That is allowed, but
  **tell the user** — those results will not be consistent, and the fix is to
  fill the glossary, not to re-run this skill.

## Step 2 — Start the live progress watcher, then fan out subagents

First launch the background watcher **once** — it ticks every 10s independently of
the main loop (so it keeps reporting even while a batch of subagents is in
flight). Use the `Bash` tool with `run_in_background: true`:

```bash
node .claude/skills/translate/scripts/progress.mjs --watch
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
node .claude/skills/translate/scripts/progress.mjs
```

Then send the next batch. Use this exact prompt, substituting the entry's `in`
and `out` absolute paths:

````text
You are a professional software-localization translator specializing in
MANUFACTURING ERP/MES software. Your translations are read all day by machine
shop staff — planners, buyers, quality engineers, shop-floor operators.

Read the input file (JSON) at this absolute path:
<manifest entry `in`>

It is: { "locale", "langLabel", "catalog", "domain", "glossary", "doNotTranslate",
"items": [ { "msgid", "note?" } ] }.
Translate every item's `msgid` from English into the language named by `langLabel`.

Read `domain` first — it tells you what this product is. Translate the way an ERP
is translated in that market, using the terminology a manufacturing professional
there expects. A literal dictionary rendering is usually WRONG here: a "Job" is a
shop-floor work order (not employment), a "Receipt" is goods arriving from a
supplier (not a payment slip), an "Operation" is a routing step (not an action).

GLOSSARY — this overrides your own judgement:
G1. `glossary` lists the domain terms that appear in THIS chunk. Each entry is
    { term, approved, meaning, onlyAppliesTo?, sameWordAs? }.
G2. If `approved` is a string, use THAT WORD wherever the term appears — do not
    substitute a synonym you prefer.
G2a. `approved` is the BASE (dictionary) form, not text to paste in. Inflect it
    so the sentence is grammatical: decline it, pluralise it, agree its gender,
    add the case ending, apply vowel harmony — whatever the language requires.
    A translation that reads as pasted-in is a FAILURE, not compliance. What
    must stay constant is the WORD CHOICE, never the exact characters.
G3. If `approved` is null, the term is NOT YET APPROVED. Use `meaning` to
    translate it correctly for the domain, and use the SAME rendering for every
    occurrence within this chunk. Null does not mean "translate freely".
G4. `onlyAppliesTo` means the English word has a non-domain sense too. Apply the
    approved rendering ONLY to the domain sense described. Example: "Part" as a
    component, never inside "part of".
G5. `sameWordAs` lists alternate English spellings of the same term — they all
    take one identical translation.
G6. Never translate anything in `doNotTranslate`.

RULES — follow exactly:
1. Preserve every placeholder EXACTLY: `{0}`, `{name}`, `{count}`, etc. Never
   translate, rename, reorder-away, or drop a placeholder token.
2. For ICU syntax like `{0, plural, one {…} other {…}}`, keep the structure,
   keywords (`plural`, `select`, `one`, `other`, `=0`, `#`) and braces intact;
   translate ONLY the human words inside each `{…}` branch.
3. Preserve leading/trailing spaces, capitalization intent, and punctuation.
4. Do NOT translate brand names, code identifiers, or placeholder variable names.
5. Use `note` only as context for a placeholder; never include it in the output.
6. Every ASCII `"` INSIDE a key or value must be escaped as `\"`, or the whole
   chunk is unparseable and every string in it is silently dropped. Many msgids
   quote a word (`Pick another "field"`); prefer the target language's own
   quotation marks (`“ ”`, `« »`, `„ “`) over a bare ASCII `"`. Re-read your
   output and confirm it parses as JSON before writing.

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
node .claude/skills/translate/scripts/merge-translations.mjs
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
`TRANSLATE_CHUNK_SIZE=15 node .claude/skills/translate/scripts/extract-missing.mjs`.

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

## Step 7 — Verify terminology AGREES

Step 6 proves nothing is missing. It does not prove anything is consistent — the
original defect shipped through a green `linguito check`.

```bash
node .claude/skills/translate/scripts/check-glossary.mjs
```

It reads every translated string whose English contains a glossary term and
confirms the approved rendering is present. Exit 0 = clean, 1 = violations.

| Result | Action |
|--------|--------|
| `No approved translations yet` | The glossary has no filled column for these locales, so there is nothing to check against. Report that plainly — do NOT report the run as "consistent". |
| Exit 0 with approved terms | Verified consistent → Step 8. |
| Violations listed | Report them for review — do NOT just re-run this skill. A violation has a NON-EMPTY `msgstr`, and every step above only fills empty ones, so a retry cannot touch it. Clearing it first is what makes it re-translatable: `node .claude/skills/translate/scripts/reset-violations.mjs --locale <locale> --dry-run`, then without `--dry-run`, then re-run this skill. That is a terminology repair, not a fill — follow `.ai/plans/2026-08-27-translation-consistency-runbook.md`. Advisory hits on `ambiguity` terms are judgement calls — read before acting. |

Use `--locale zh --max 40` to focus, `--json` for the full machine-readable list.

Report: total filled, per-locale counts, glossary coverage per locale, any
residual, any violations, and that the changed files are
`packages/locale/locales/*/*.po`.

## Step 8 — Clean up scratch (always, even on partial/failed runs)

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
- [ ] `node .claude/skills/translate/scripts/merge-translations.mjs` reports
      `Remaining empty msgstr ... : 0` (or the residual is reported after 3 rounds).
- [ ] `pnpm run lingui:clean` has run.
- [ ] `pnpm exec linguito check` exits 0 (or the residual is reported after 3 rounds).
- [ ] `node .claude/skills/translate/scripts/check-glossary.mjs` exits 0, OR its
      "no approved translations yet" state was reported honestly to the user.
- [ ] Only `msgstr` lines changed in the `.po` diff (no `msgid` touched):
      `git diff --no-color packages/locale/locales | grep -E '^\+' | grep -vE '^\+msgstr|^\+\+\+'` is empty.
- [ ] `glossary.json` is UNCHANGED — this skill reads it, never writes it:
      `git diff --quiet packages/locale/locales/glossary.json`
- [ ] `.ai/scratch/translate` has been removed.

## Failure → action
| Symptom | Action |
|---------|--------|
| `extract-missing.mjs` errors reading config | Confirm `packages/locale/src/config.ts` still defines `supportedLanguages` + `languageNativeLabels`; the parser reads them by regex. |
| `Cannot find ... glossary.json` | The glossary moved or was deleted. It is the source of terminology — STOP and tell the user; do not translate without it. |
| Merge shows many `unmatched` | The model rewrote keys. Re-run the round with smaller `TRANSLATE_CHUNK_SIZE`; unmatched entries stay empty and are retried next round. |
| A subagent dies / returns no file | That chunk's `out` is listed as missing; the next retry round re-dispatches only the still-empty entries. |
| `lingui:extract` produces huge unrelated diff | Expected on this branch; `lingui:clean` strips the date/origin churn. Real content changes are legitimate. |
| `check-glossary.mjs` reports many violations in ONE locale | That locale's approved terms are probably wrong for the domain rather than the translations being wrong. Do not mass-rewrite — surface it for native-speaker review. |
| A term is missing from the glossary | Report it. Adding terms is a reviewed decision outside this skill. |
