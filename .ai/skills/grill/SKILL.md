---
name: grill
description: Interview the user relentlessly, one question at a time, to stress-test a plan, spec, or design until every open decision is resolved — recommended answer per question, answers cross-checked against the codebase and the @carbon/glossary domain terms, resolutions written back to the artifact as they land. Use when the user says "grill me", wants to stress-test a design or plan, or a spec's Open Questions need resolving (spec-writing Step 7 invokes this). Do not use to author the artifact itself — use /spec-writing for specs, /plan for implementation plans.
---

# grill — stress-test a design by interviewing its author

Input: a plan, spec, or design idea (in a file or only in chat). Output: every
open decision resolved with the human one branch at a time, each resolution
written to its canonical home, and every contradiction between the user's
answers and the codebase surfaced along the way.

**Announce at start:** "Using the grill skill — stress-testing {target}."

## Step 1: Identify the target and its write destination

| Grilling | Questions come from | Resolutions written to |
|----------|--------------------|------------------------|
| A spec (`.ai/specs/…`) | its Open Questions section, plus anything fuzzy in Design Decisions | inline in the spec: `- [x] {Question} — **Answer:** {decision and rationale}`, plus a changelog entry when done |
| A plan (`.ai/plans/…`) | ambiguous or risky tasks, missing acceptance criteria | the affected task in the plan file |
| An idea in chat (no artifact) | the whole decision tree of the idea | `.ai/runs/{YYYY-MM-DD}-grill-{slug}.md` — create it when the first decision lands |

If the target has no artifact and the grill reveals it is spec-worthy (new
module, data-model change, or 3+ files — the `/spec-writing` table), say so
and offer `/spec-writing`. Continue grilling artifact-less only if the user
declines.

## Step 2: Pick the depth from the blast radius

| Target involves | Depth |
|-----------------|-------|
| New module, data-model change, or cross-module behavior | **Full grill** — strictly one question per message |
| Anything smaller | **Light grill** — closely-related questions may be grouped, max 2–3 per message |

Depth changes grouping only. Every rule in Step 3 applies at both depths, and
**never** present the entire question list at once and wait for batch answers.

## Step 3: Interview

Walk the decision tree branch by branch, resolving dependencies between
decisions one by one. Wait for the user's answer before continuing. For every
question:

- Order by dependency: settle decisions that other questions hinge on first.
- Attach your recommended answer with a one-line rationale.
- If the question can be answered by exploring the codebase or an existing
  research file, answer it that way instead of asking.
- Cross-check every answer against the code. Surface contradictions
  immediately, with file references: "you said X, but `{file}` does Y —
  which is right?"
- Stress-test fuzzy answers with a concrete scenario before accepting them
  ("a PO has 3 lines and one is already received — what happens on cancel?").
- Sharpen fuzzy terms. When the user uses a vague or overloaded word, propose
  the precise canonical term. Check `packages/glossary` (the `terms` object in
  `@carbon/glossary`) for an existing definition and challenge conflicts:
  "the glossary defines {term} as {definition}; you seem to mean {other} —
  which is it?"

## Step 4: Write back as each decision lands

Do not batch write-backs to the end of the session — record each resolution in
the Step 1 destination in the same turn it is decided. Two extra destinations
apply regardless of target:

- A decision that sets a durable convention beyond this feature → update the
  matching `.ai/rules/*.md` file in the same turn.
- A genuinely new canonical domain term → offer a `@carbon/glossary` entry,
  only when all three hold: the term is user-facing (UI or docs), the grill
  revealed real ambiguity, and the user confirmed the definition. Follow
  `packages/glossary/AGENTS.md` (its "Ask First" rule is satisfied by the
  user's confirmation in the interview).

## Done when

- [ ] No unresolved branches: every question answered by the user, the
      codebase, or an explicit documented "out of scope" decision
- [ ] Every resolution recorded in the Step 1 destination — none live only in
      chat
- [ ] Durable conventions reflected in `.ai/rules/`; glossary offers made
      where the three-part test passed

## Anti-patterns

- Dumping the full question list in one message and accepting batch answers
- Accepting an answer without checking it against the code
- Resolving a question yourself to keep moving — only the user, the codebase,
  or a documented out-of-scope decision resolves a question
- Recording decisions only in chat ("I'll write them up at the end")

Red flags — thinking any of these means the grill is being defeated; STOP:

- "the user probably means X, I'll assume it" (that assumption IS the question)
- "we can settle this during implementation"
- "I'll batch the write-backs when the session ends"
