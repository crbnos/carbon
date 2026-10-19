---
name: explain
description: Render a spec, plan, or research file from .ai/ as a self-contained HTML explainer saved beside it (same name, .html) — plain STE-80 prose, one SVG diagram of the whole change, before/after tabs, collapsible decisions and tasks — so a human understands it in minutes instead of reading the markdown. Use when asked to "explain this spec/plan", "make it readable", "visualize the plan", "make an HTML page for this", or after /spec-writing or /plan when someone must review the result. Do not use to design or change the content — the .md stays the source of truth (use /spec-writing or /plan) — and do not use for a pull request (use /pr-explainer).
---

# explain — turn a spec or plan into a page a human can understand fast

Input: one markdown file in `.ai/specs/`, `.ai/plans/` or `.ai/research/`.
Output: `{same path}.html` beside it — one self-contained file, committed with
its source. The page explains the source. It never adds to it or replaces it:
`/plan` and `/execute` keep reading the `.md`.

The idea (from Andrej Karpathy): as agents write more of the work, humans spend
more time understanding it. Three layers help, in order: controlled plain
writing (STE-80), a diagram, and an interactive page. This skill produces all
three in one file.

**Announce at start:** "Using the explain skill — building the HTML explainer
for {source path}."

## Step 1: Resolve the source

| Request | Source |
|---------|--------|
| A path is given | that file |
| "the spec" / "this spec", no path | last-modified dated spec: `ls -t .ai/specs/2*.md \| head -1` |
| "the plan", no path | last-modified dated plan: `ls -t .ai/plans/2*.md \| head -1` |
| Two or more files match the user's words | ask which one — do not guess |

Pick the template:

| Source is under | Template |
|-----------------|----------|
| `.ai/plans/` | `.claude/skills/explain/assets/plan.html` |
| `.ai/specs/` or `.ai/research/` | `.claude/skills/explain/assets/spec.html` |

If the source is a spec with unchecked Open Questions (`- [ ]`), continue, but
show them in a `.callout.warn` at the top of "Decisions". The page must not
look final when the spec is not.

## Step 2: Read the source, then the code it names

1. Read the whole source file.
2. Read `.claude/rules/writing-ste.md`. Every sentence you write follows it.
3. Open each file, table or function that will appear anywhere on the page
   (diagram, tasks, decisions, terms). Confirm it exists: `ls {path}` or
   `grep -rn "{name}" {dir}`.

🛑 Every fact on the page comes from the source or from code you opened. Do not
add a fact to "complete the picture".

When the source and the code differ, use this table:

| The difference | Action |
|----------------|--------|
| The source describes the code BEFORE its change ("Cause", "Today", "Current behavior") | expected — explain it as the old behavior |
| A path or line number in the source no longer exists (the code moved) | show the file name without the line number; list it under "source drift" in the Step 7 report |
| The source's status does not match the code (says implemented but the code differs, or says draft but the code already has it) | do not choose one; explain the source, list it under "source drift" |
| The source contradicts itself (a design section vs an acceptance criterion) | render both as written, add a `.callout.warn` naming the two sections, list it under "source drift" |
| You cannot tell what the source means | STOP and ask the user |

Never correct the source on the page. The user fixes the source; then the page
is regenerated.

## Step 3: Choose the one picture

One diagram must explain the whole change. Choose it from this table — the
first row that matches wins:

| The source is mostly about… | Draw |
|-----------------------------|------|
| the source has a Mermaid overview diagram | the same picture in SVG: the same nodes, edges and changed (`hot` / `new`) marks — the spec author chose it |
| a plan (any plan) | task graph: one column per dependency layer (the plan template has it) |
| several independent fixes or changes (a bundle) | fix grid: one row per fix — fix name as `<text>` at x = 40, before box (`risk`) at x = 240, after box (`hot`) at x = 440, optional `small` note at x = 640; more than 6 fixes → a table instead of a figure |
| a status or lifecycle | state diagram: one box per status, one edge per transition, label each edge with its trigger |
| work that moves between people, modules or services | swimlanes: one lane per actor, boxes in time order left to right |
| a changed calculation or behavior | before → after: two rows of boxes, the same steps, the changed box `hot` |
| new or changed tables | entity boxes: table name + key columns, edges for foreign keys (the "Data model" figure) |
| none of the above | a left-to-right flow of the main steps |

Draw it with the SVG primitives already in the template (`.box`, `.box.hot`,
`.box.new`, `.box.risk`, `.lane`, `.edge`, `.edge.hot`, the `#arrow` markers).
Layout rules:

- `viewBox` width is 800. Make the height fit the content. Only the task
  graph may be wider (see the comment in `plan.html`).
- Box 160×56 (task graph: 160×48). Columns at x = 40, 240, 440, 640 — at most
  4 boxes in a row, 40px apart. Rows 90px apart (task graph: 70px).
- A label inside a 160px box is at most 18 characters. Put a longer detail in
  a second `<text class="small">` line or in the caption.
- At most 8 boxes in one figure. Two exceptions: the task graph (one box per
  task) and the fix grid (two boxes per fix, at most 6 fixes).
- Never put a color in the SVG. Use only the classes, so dark mode works.
- Give each `<svg>` an `aria-label` that says what it shows in one sentence.
- One main figure in "The picture". You may add ONE more figure only in the
  "Data model" section (spec) or below the task graph (plan, for example the
  shape of a new API). No third figure.

## Step 4: Copy the template and stamp the source

```bash
SRC=.ai/specs/2026-10-04-example.md            # the source from Step 1
OUT="${SRC%.md}.html"
cp .claude/skills/explain/assets/spec.html "$OUT"   # plan.html for a plan
git hash-object "$SRC"
# Expected: a 40-character hex hash
```

Put `$SRC` in the `explain-source` meta, the kicker and the footer. Put the hash
in the `explain-source-hash` meta. Step 6 and "Keeping pages fresh" compare
that hash with the source to find a stale page.

## Step 5: Fill every section

Work top to bottom. Each `<!-- FILL: … -->` comment says what goes there.
Delete the comment after you fill its section. Delete a whole `<section>` when
the comment says it may be deleted and the source has nothing for it.

Writing rules (from `.claude/rules/writing-ste.md`):

- Rewrite, do not paste. A paragraph copied from the markdown is a failure.
- Instructions ≤ 20 words. Facts ≤ 25 words. One idea per sentence.
- Active voice: name the actor ("The route action saves the row").
- Use the term the source uses, the same one every time.
- Domain terms and code identifiers are allowed — put identifiers in `<code>`.

Specs do not all use the template headings. Map each source section by its
role. The names in brackets are the common alternatives.

Spec template mapping:

| Page section | From the source |
|--------------|-----------------|
| Kicker status | the source's Status line, verbatim ("Awaiting approval", "draft") |
| TL;DR (3 sentences) | TLDR [Summary] + Problem Statement [Problem, Background] |
| Scope | Goals / Non-goals [In scope / Out of scope]; delete when absent |
| The picture | Step 3 |
| The problem + Example | Problem Statement; the example uses synthetic numbers and names (Jane Doe, PART-001) |
| How it works | Proposed Solution [Design, Approach], as numbered actions |
| Before and after | the same scenario run through the old and the new behavior; for a bundle, one numbered item per fix in each tab |
| Decisions | the Design Decisions table + resolved Open Questions; `human` tag for `**Answer:**`, `assumed` tag for `**Autonomous:**`, no tag when no question traces to the row |
| Data model | Data Model Changes [Schema, Migrations]; delete when the source changes no schema |
| Done when | Acceptance Criteria [Done when, Success criteria] |
| Terms | every domain term a newcomer needs; copy the definition from `docs/content/src/glossary/terms.ts` when the term is there |

Plan template mapping:

| Page section | From the source |
|--------------|-----------------|
| Kicker branch / spec | the `**Branch:**` and `**Spec:**` lines; no line → delete the branch segment, write "none" for the spec |
| Progress bar | count `- [x]` and `- [ ]` in the Progress list (else in the Steps checklist) |
| Task graph | each task's `Depends on:` line; no such lines → list order, 4 per row, caption says so |
| Tasks | one `<details class="task">` per task (or per Steps item); add `done` when its box is checked; delete the Files / Verify / Stop-if parts the source does not give |
| Decisions | a Decisions / Notes section, if any; delete when absent |
| Risks and stop points | every "STOP" / "If … turns out false" line |
| Out of scope | every task's "Out of scope" line, without duplicates |

Interactive parts — use only these three:

1. **Tabs** (`[data-tabs]`) for before/after. The script is in the template.
2. **`<details>`** for depth a first-time reader can skip.
3. **A worked example calculator** — only when the source defines a formula
   (a quantity, a price, a rounding rule). Add `<input type="number">` fields
   prefilled with the source's example values and a few lines in the existing
   `<script>` that recompute the result. No libraries.

## Step 6: Check the page yourself

Do every check below on `$OUT`. Do not hand any of them to the human. If a
check fails, fix the page and do that check again.

**1. Nothing left from the template.** Search the page:

```bash
grep -n "FILL" "$OUT"
grep -nE '<(p|li|td|dd)( [^>]*)?>[[:space:]]*</(p|li|td|dd)>' "$OUT"
# Expected: no output from either command
```

Then search for the sample text of the template you copied. Each line below must
return nothing: "Sentence one.", "Step A", "Step B", "Feature name",
"Imperative title", "newThing", "newTable", "path/to/file.ts", "<dt>Term</dt>",
"Definition in one STE-80 sentence.", "YYYY-MM-DD-slug", "0 of 0 tasks".

**2. The page is one self-contained file.**

```bash
grep -nE '<(script|link|img|iframe)[^>]*(src|href)="(https?:)?//' "$OUT"
# Expected: no output
```

**3. Every SVG works in dark mode and has a label.**

1. Read each `<svg>`. It uses only the template classes (`.box`, `.edge`, …).
2. Make sure no `fill=`, `stroke=` or `style=` attribute holds a `#`, `rgb` or `hsl` color.
3. Make sure each `<svg>` tag has a non-empty `aria-label`.
4. Make sure no label is wider than its box and no edge crosses a box it does not connect to.

**4. The HTML is well-formed.** Read the page from top to bottom once. Every
`<section>`, `<details>`, `<div>`, `<ul>`, `<table>` and `<svg>` you opened
has its closing tag, in the right order. Pay most attention to the sections you
deleted or duplicated.

**5. The page matches its source.**

```bash
git hash-object "$SRC"
grep -o 'name="explain-source-hash" content="[^"]*"' "$OUT"
# Expected: the same 40-character hash in both lines
```

**6. The prose is STE-80.** Do the STE-80 review pass
(`.claude/rules/writing-ste.md` → Enforcement) on all page text. Skip code,
the SVG and quoted template text. Check these 3 limits:

1. Instruction sentences (plan tasks, verify steps): 20 words at most.
2. Fact sentences: 25 words at most. A spec's "How it works" steps are facts.
3. A rationale may go to 30 words.

**7. Every fact is real.** For each fact on the page, point to the line in the
source or the code you opened in Step 2. Delete a fact you cannot point to.

Then give the user the path and this command to open the page:

```bash
open .ai/specs/2026-10-04-example.html
```

## Step 7: Report

One short message: the page path, the diagram you chose and why (one line),
and the "source drift" list from Step 2 (or "no source drift"). Commit only when the user asks, through
`/check-and-commit`, with the `.html` and its source in the same commit.

## Done when

- [ ] `{source}.html` exists beside the source
- [ ] Every check in Step 6 passes, done by you, not the human
- [ ] The page has exactly one main diagram chosen by the Step 3 table
- [ ] No fact on the page is missing from the source or the code

## Keeping pages fresh

The page records the hash of its source. When the source changes, the page is
stale. To find every stale page, compare each page's recorded hash with its
source:

```bash
for page in $(grep -rl 'name="explain-source"' .ai --include='*.html'); do
  src=$(grep -o 'name="explain-source" content="[^"]*"' "$page" | sed 's/.*content="//; s/"$//')
  rec=$(grep -o 'name="explain-source-hash" content="[^"]*"' "$page" | sed 's/.*content="//; s/"$//')
  [ -f "$src" ] && [ "$(git hash-object "$src")" = "$rec" ] || echo "STALE $page"
done
# Expected: no output. Each STALE line names a page to regenerate.
```

For each stale page, run this skill again on its source. When a spec moves to
`.ai/specs/implemented/`, move its `.html` too and update the source path in
the meta, the kicker and the footer.

## Failure → action

| Symptom | Action |
|---------|--------|
| The source has neither a problem/design section (spec) nor a task or step list (plan) | STOP — tell the user which file you found and ask which one they meant |
| The main diagram needs more than 8 boxes (not a task graph) | draw the top level only, and put the detail in `<details>` sections |
| One Step 6 check fails twice after your fix | STOP — report the check and the section of the page it refers to |

## Red flags — stop and re-read this skill

- "I'll add a detail the spec forgot" — the page only explains; fix the source with /spec-writing.
- "This paragraph is fine as it is, I'll paste it" — rewrite it in STE-80.
- "A CDN chart library would be faster" — the page must work offline, as one file.
- "Three diagrams show it better" — one main picture, plus at most one in the allowed places (Step 3).
- "The code differs, so I'll describe the code" — explain the source and report the drift.
