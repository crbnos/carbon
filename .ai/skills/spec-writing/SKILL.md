---
name: spec-writing
description: Design a feature and write its spec at .ai/specs/{YYYY-MM-DD}-{slug}.md, with competitor research and explicit design decisions. Open questions are resolved with the user BEFORE the spec is written — the interview comes first, the document second. Use when designing or brainstorming a new feature, a new module, a data-model change, or any change touching 3+ files or crossing modules. Do not use for small bug fixes or one-file refactors, and do not start implementation from this skill — implementation starts only after the spec is written with every question resolved.
---
<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

# spec-writing — research, grill the open questions, THEN write the spec

Input: a feature request. Output: a complete spec at
`.ai/specs/{YYYY-MM-DD}-{slug}.md` written **after** every open question has
been resolved with the user. The interview happens before the document exists,
so the spec is written once, around real answers — not written around guesses
and reworked after the fact.

The spec is the single design artifact. Do not write separate "design docs" in
other locations.

**Announce at start:** "Using the spec-writing skill — designing {feature};
I'll bring you the open questions before writing the spec."

## When to write a spec

| Situation | Action |
|-----------|--------|
| New module | Write spec |
| Feature touching 3+ files | Write spec |
| Data model change | Write spec |
| Cross-module behavior change | Write spec |
| Small bug fix or one-file refactor | Skip spec — use /root-cause + /fix |

Lifecycle and naming rules live in `.ai/specs/AGENTS.md`. Read it once before
your first spec.

## Step 1: Scope the request

If the request is ambiguous, ask the user at most 3–4 focused questions covering:
**what** (the capability), **why** (the problem), **where** (ERP, MES, or both),
**who** (the users). If the request is already clear, skip to Step 2.

## Step 2: Read Carbon context

Run all of these before designing anything:

```bash
ls .ai/specs/ .ai/specs/implemented/ | grep -i {keyword}   # prior art — never duplicate a spec
cat .ai/lessons.md                                          # known pitfalls
cat .ai/docs/module-conventions.md                          # module layout rules
cat apps/erp/app/modules/{module}/AGENTS.md                 # for every module touched
```

Then read the `.ai/rules/` files matching the domain (use the Task Router table
in the root `AGENTS.md` to find them).

## Step 3: Research competitors

Invoke `/research {feature}`. This is mandatory for ERP-domain features
(accounting, costing, tax, inventory valuation, RMA, planning, etc.) — do not
invent domain logic. Findings land in `.ai/research/{slug}.md`; cite that file
from the spec.

## Step 4: Make the design decisions — and separate the questions

For each significant decision (data model shape, status lifecycle, workflow,
integration point):

1. State the question.
2. Cite what the research found ("SAP and NetSuite both…").
3. List 2–3 options with one-line trade-offs.
4. **Decide it yourself if the research + codebase settle it** — record the
   choice and rationale for the spec's Design Decisions table.
5. **If you cannot settle it, it is an open question** — genuine domain
   ambiguity, scope boundaries, data-model alternatives with real trade-offs,
   product-positioning calls, anything where the user's answer changes what
   you build. Do NOT pick a placeholder and move on; do NOT write "TBD".

Run every new or modified entity through this checklist; decided rows go in the
Design Decisions table, unsettled ones join the question list:

| # | Heuristic | Question to answer |
|---|-----------|--------------------|
| 1 | Multi-tenancy | Does every new table have `companyId` + composite PK `("id", "companyId")` + `id('prefix')` default? |
| 2 | Service shape | Does every service function take `client` first, return `{data, error}`, never throw? |
| 3 | RLS coverage | Does every new table have SELECT/INSERT/UPDATE/DELETE policies per `.ai/rules/conventions-database.md`? |
| 4 | Permission scoping | Does `requirePermissions` in every route use the correct `{module}_{action}` scope? |
| 5 | Form pattern | Does every form use `ValidatedForm` + `validator(zodSchema)` + a route action? |
| 6 | Module layout | One `{module}.service.ts`, one `{module}.models.ts`, barrel `index.ts`? |
| 7 | Backward compatibility | Any FROZEN/STABLE surface touched (see `BACKWARD_COMPATIBILITY.md`)? What is the migration path? |

At least one open question is required before proceeding. Zero questions means
you haven't thought hard enough — re-read the research and the heuristics table.

## Step 5: Grill — resolve the questions with the user BEFORE writing

> 🛑 HARD STOP: the spec file is not written while any question is unresolved.

Invoke `/grill` on the question list (protocol: `.ai/skills/grill/SKILL.md` —
the spec doesn't exist yet, so this is its artifact-less mode; resolutions
carry into the spec's Open Questions section when it is written in Step 6).
Interview **one question at a time** (group max 2–3 only for single-module,
no-schema designs). For each question:

- State the question and **why it matters** (what changes downstream).
- Give your **recommended answer** with a one-line rationale, plus the
  alternatives and their trade-offs.
- Cross-check the user's answer against the codebase before accepting it — if
  the answer contradicts something real (an existing table, a lesson in
  `.ai/lessons.md`, a prior spec), say so and re-ask.
- Record the resolution: `- [x] {Question} — **Answer:** {decision and rationale}`.

The user may batch ("accept all recommendations") — that is their call to make,
not yours to assume. Never resolve a question yourself to unblock work;
resolutions come only from a human answer, a research finding, or an explicit
documented "out of scope for v1" decision.

### Autonomous mode (automated loops — conductor, headless/outer-loop runs)

When this skill runs inside an automated loop with no human available, **do
not invoke `/grill` and do not block waiting for answers.** Instead:

- Resolve each question in this order: (1) codebase precedent, (2) research /
  competitor consensus, (3) your recommended answer. Record it inline as
  `- [x] {Question} — **Autonomous:** {answer + rationale}` so assumed
  decisions are distinguishable from human ones at a glance.
- Surface the full list of autonomous resolutions in the spec changelog AND in
  the loop's "Assumed decisions" PR section — the human reviews them at the
  PR, not mid-loop.
- **Ask-First territory is never resolved autonomously** (root `AGENTS.md`:
  production-critical schema, auth/RBAC/multi-tenancy, public contracts,
  scope reductions, new production dependencies). A question in that
  territory → the loop goes BLOCKED with the question stated crisply.

## Step 6: Write the spec

Only now. Copy `.ai/specs/template.md` to `.ai/specs/{YYYY-MM-DD}-{slug}.md`
(today's date, kebab-case slug) and fill every section, with the Step-5
resolutions baked into the design. Rules:

- SQL sketches use `id('prefix')`, `companyId`, composite PK, audit columns —
  never `gen_random_uuid()`.
- Acceptance criteria must be testable: "user creates a PO with 3 lines and sees
  correct totals in the list view", not "works correctly".
- No `{placeholders}` left in the file; mark inapplicable sections `N/A` with a
  reason.
- The Open Questions section records the resolved Q&A (all boxes checked, each
  with its inline answer) — it is the audit trail of Step 5, not a to-do list.

## Step 7: New questions discovered while writing

Writing the spec sometimes surfaces questions Step 4 missed. When that happens:

- Add them to the Open Questions section as unchecked items with "why it
  matters".
- Take them back to the user (same protocol as Step 5) **before calling the
  spec final** — the hard stop applies to these too. Do not say "we can figure
  these out during implementation."

## Step 8: Finalize

After every question is resolved: add a changelog entry, set status per
`.ai/specs/AGENTS.md`. The spec is now ready for `/plan` (or `/feature`, which
calls it).

## Done when

- [ ] Every open question was answered by the user BEFORE the spec was written
      (Step 5), with the resolution recorded inline in the spec
- [ ] Spec exists at `.ai/specs/{YYYY-MM-DD}-{slug}.md`, every section real content,
      design reflecting the resolutions (no section contradicts an answer)
- [ ] Research file exists and is linked from the spec
- [ ] Every applicable heuristic (1–7) has a row in Design Decisions — no TBDs
- [ ] Any questions surfaced during writing (Step 7) were also resolved before
      the spec was called final

## Anti-patterns

- Writing the spec first and interviewing the user afterward (the old flow —
  it produces rework: the document gets written around guesses, then edited
  around answers)
- Writing a design doc anywhere other than `.ai/specs/`
- Dumping all open questions in one message and accepting batch answers you
  assumed rather than the user chose
- Accepting an answer without checking it against the code
- Marking questions resolved without human input
- Skipping `/research` because "I know how ERPs work"
- "TBD" in the Design Decisions table (that's an open question — Step 5 it)
- Vague acceptance criteria ("feature works as expected")

Red flags — thinking any of these means the gate is being defeated; STOP:

- "I'll draft the spec now and confirm the questions after" (that IS the old flow)
- "I'll mark this question resolved so we can keep moving"
- "zero open questions — the design is clear" (you haven't looked hard enough)
- "we can settle this during implementation"
- "the user probably wants X, I'll assume it" (that assumption IS the question)
