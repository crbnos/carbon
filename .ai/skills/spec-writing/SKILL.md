---
name: spec-writing
description: Design a feature and write its spec at .ai/specs/{YYYY-MM-DD}-{slug}.md, with competitor research, explicit design decisions, and an Open Questions hard stop. Use when designing or brainstorming a new feature, a new module, a data-model change, or any change touching 3+ files or crossing modules. Do not use for small bug fixes or one-file refactors, and do not start implementation from this skill — implementation starts only after every open question is resolved.
---
<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

# spec-writing — design a feature, produce a spec, stop at open questions

Input: a feature request. Output: a complete spec at
`.ai/specs/{YYYY-MM-DD}-{slug}.md` whose **Open Questions section is a hard
stop** — implementation must not start while any question is unresolved.

The spec is the single design artifact. Do not write separate "design docs" in
other locations.

**Announce at start:** "Using the spec-writing skill — designing {feature} and
drafting the spec."

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

## Step 4: Make the design decisions

For each significant decision (data model shape, status lifecycle, workflow,
integration point):

1. State the question.
2. Cite what the research found ("SAP and NetSuite both…").
3. List 2–3 options with one-line trade-offs.
4. Pick one and say why. If you cannot pick, it is an Open Question — do not
   write "TBD" as a decision.

Run every new or modified entity through this checklist and record the answer in
the spec's Design Decisions table:

| # | Heuristic | Question to answer |
|---|-----------|--------------------|
| 1 | Multi-tenancy | Does every new table have `companyId` + composite PK `("id", "companyId")` + `id('prefix')` default? |
| 2 | Service shape | Does every service function take `client` first, return `{data, error}`, never throw? |
| 3 | RLS coverage | Does every new table have SELECT/INSERT/UPDATE/DELETE policies per `.ai/rules/conventions-database.md`? |
| 4 | Permission scoping | Does `requirePermissions` in every route use the correct `{module}_{action}` scope? |
| 5 | Form pattern | Does every form use `ValidatedForm` + `validator(zodSchema)` + a route action? |
| 6 | Module layout | One `{module}.service.ts`, one `{module}.models.ts`, barrel `index.ts`? |
| 7 | Backward compatibility | Any FROZEN/STABLE surface touched (see `BACKWARD_COMPATIBILITY.md`)? What is the migration path? |

## Step 5: Write the spec

Copy `.ai/specs/template.md` to `.ai/specs/{YYYY-MM-DD}-{slug}.md` (today's
date, kebab-case slug) and fill every section. Rules:

- SQL sketches use `id('prefix')`, `companyId`, composite PK, audit columns —
  never `gen_random_uuid()`.
- Acceptance criteria must be testable: "user creates a PO with 3 lines and sees
  correct totals in the list view", not "works correctly".
- No `{placeholders}` left in the file; mark inapplicable sections `N/A` with a
  reason.

## Step 6: Open Questions — HARD STOP

Populate the Open Questions section with every genuine unknown (domain
ambiguity, scope boundaries, data-model alternatives you couldn't settle,
performance, UX choices):

```markdown
## Open Questions

> 🛑 HARD STOP: Do not proceed with implementation until these are answered.

- [ ] {Question} — {why it matters}
```

Rules:

- At least one open question is required. Zero questions means you haven't
  thought hard enough — re-read the research and the heuristics table.
- Never resolve questions yourself to unblock work. They are resolved only by a
  human answer, a research finding, or an explicit documented "out of scope for
  v1" decision.
- Record each resolution inline: `- [x] {Question} — **Answer:** {decision and rationale}`.

## Step 7: Grill — resolve the questions interactively

Show the user the spec path and the list of open questions, then invoke
`/grill` on the spec (protocol: `.ai/skills/grill/SKILL.md`). The grill
interviews the user through the questions one at a time (grouped max 2–3 only
for single-module, no-schema specs), with a recommended answer per question
and codebase cross-checks, recording each resolution inline as it lands:
`- [x] {Question} — **Answer:** {decision and rationale}`.

Do not say "we can figure these out during implementation." The hard stop
holds until every box is checked.

## Step 8: Finalize

After every question is resolved (checked off during the Step 7 grill): add a
changelog entry, set status per `.ai/specs/AGENTS.md`. The spec is now ready
for `/plan` (or `/feature`, which calls it).

## Done when

- [ ] Spec exists at `.ai/specs/{YYYY-MM-DD}-{slug}.md`, every section real content
- [ ] Research file exists and is linked from the spec
- [ ] Every applicable heuristic (1–7) has a row in Design Decisions — no TBDs
- [ ] Open Questions has ≥1 entry, each with "why it matters"
- [ ] Every question resolved through the Step 7 grill at the correct depth,
      with the answer recorded inline — work is stopped until then

## Anti-patterns

- Writing a design doc anywhere other than `.ai/specs/`
- Dumping all open questions in one message and accepting batch answers
- Accepting an answer without checking it against the code
- Marking questions resolved without human input
- Skipping `/research` because "I know how ERPs work"
- "TBD" in the Design Decisions table (that's an Open Question)
- Vague acceptance criteria ("feature works as expected")

Red flags — thinking any of these means the gate is being defeated; STOP:

- "I'll mark this question resolved so we can keep moving"
- "zero open questions — the design is clear" (you haven't looked hard enough)
- "we can settle this during implementation"
- "the user probably wants X, I'll assume it" (that assumption IS the question)
