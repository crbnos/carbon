<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->
---
name: spec-writing
description: Write a feature spec with a hard-gate Open Questions stop. Grounds design in Carbon's architectural heuristics and ERP competitor research. Produces a spec at .ai/specs/{YYYY-MM-DD}-{slug}.md following the spec lifecycle in .ai/specs/AGENTS.md.
---

# spec-writing — Feature Spec with Open Questions Hard Gate

Write a complete feature spec grounded in Carbon's architecture and real ERP
precedent. The Open Questions section is a **HARD STOP** — do not proceed to
implementation until every question is resolved.

**Announce at start:** "I'm using the spec-writing skill to draft the feature spec."

## When to Use

| Trigger | Action |
|---------|--------|
| New module | Write spec |
| Feature touching 3+ files | Write spec |
| Data model change | Write spec |
| Cross-module behavior change | Write spec |
| Small bug fix or one-file refactor | Skip spec |

Reference `.ai/specs/AGENTS.md` for the full lifecycle and naming rules.

## Procedure

### Phase 1: Research (before writing anything)

#### 1a. Read Carbon context

```bash
# Load the conventions that apply
cat .ai/rules/conventions-index.md
cat .ai/docs/module-conventions.md

# Read AGENTS.md for every module this feature touches
cat apps/erp/app/modules/{module}/AGENTS.md

# Check for existing specs on the same topic
ls .ai/specs/ | grep -i {keyword}
ls .ai/specs/implemented/ | grep -i {keyword}

# Read relevant rules
cat .ai/rules/{relevant-rule}.md
```

#### 1b. Research comparable ERPs

Before designing, check how established ERPs solve this problem. Research at
minimum:

- **SAP** (always — it's the canonical reference)
- **One domain-specific competitor** (e.g., Fishbowl for inventory, JobBOSS for
  job shops, Epicor for manufacturing, Xero for accounting)

Save research notes to `.ai/scratch/research/{feature}.md`.

Questions to answer from research:
- What entities does SAP use for this domain?
- What status lifecycles exist?
- What edge cases does the competitor handle that we might miss?
- Is there an industry-standard term we should adopt instead of inventing one?

### Phase 2: Skeleton Draft

Write the spec skeleton using `.ai/specs/template.md` as the base. Save to:

```
.ai/specs/{YYYY-MM-DD}-{slug}.md
```

Fill in all sections **except** leave Open Questions populated with genuine
unknowns discovered during research and architectural analysis.

#### Architectural Heuristics Checklist

Run every new or modified entity through these Carbon-specific checks. Document
the answer for each applicable heuristic in the Design Decisions table.

| # | Heuristic | Question to Answer |
|---|-----------|-------------------|
| 1 | **Multi-tenancy** | Does every new table have `companyId` + composite PK `("id", "companyId")`? |
| 2 | **Service function shape** | Does every service function take `client` as first arg, return `{data, error}`, and never throw? |
| 3 | **RLS coverage** | Does every new table have SELECT / INSERT / UPDATE / DELETE policies using `get_companies_with_employee_role()` or `get_companies_with_employee_permission()`? |
| 4 | **Permission scoping** | Does `requirePermissions` in every route cover the correct module and action (view/create/update/delete)? |
| 5 | **Form pattern** | Does every user-facing form use `ValidatedForm` + `validator(zodSchema)` + route action? |
| 6 | **Module layout** | Does the new code follow `.ai/docs/module-conventions.md`? One `{module}.service.ts`, one `{module}.models.ts`, barrel `index.ts`? |
| 7 | **Backward compatibility** | Does this touch any FROZEN or STABLE surfaces? If so, what's the migration path? |

Each heuristic that applies MUST appear in the Design Decisions table with a
concrete answer — not "TBD" or "will figure out later."

#### Design Decisions Table

```markdown
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-tenancy | Composite PK `("id", "companyId")` on `{table}` | Carbon convention; required for RLS |
| RLS model | Permission-based: `{module}_view`, `{module}_create` | Matches existing module pattern |
| Service shape | `client` first arg, returns `{data, error}` | `.ai/rules/conventions-services.md` |
| {decision} | {choice} | {why} |
```

### Phase 3: Open Questions — HARD STOP 🛑

After completing the skeleton, review it and populate the Open Questions section
with **every genuine unknown**. Common sources of unknowns:

- Domain ambiguity ("Does a return create a credit memo or a negative invoice?")
- Scope boundaries ("Should this handle multi-currency in v1?")
- Data model choices ("Separate table or status column on existing table?")
- Integration points ("Does this need an event system hook for downstream?")
- Performance ("Will this RPC scale to 10k+ rows per company?")
- UX decisions ("Modal or full-page form for this workflow?")

Format:

```markdown
## Open Questions

> 🛑 HARD STOP: Do not proceed with implementation until these are answered.

- [ ] {Question 1} — {why it matters}
- [ ] {Question 2} — {why it matters}
```

**Rules for the hard gate:**
- MUST have at least one open question (if you have zero, you haven't thought
  hard enough — re-read the research notes)
- MUST NOT proceed to implementation while any question is unchecked
- Questions are resolved by: human answer, research finding, or explicit
  "out of scope for v1" decision documented in the changelog
- When a question is resolved, check it off AND record the answer inline:
  `- [x] {Question} — **Answer:** {decision and rationale}`

### Phase 4: Present and Wait

Present the spec to the user. Explicitly list the open questions and ask for
answers. Do not suggest "we can figure these out during implementation" — that
defeats the gate.

```
Here's the spec draft: .ai/specs/{YYYY-MM-DD}-{slug}.md

🛑 Open questions that need answers before we build:

1. {Question 1}
2. {Question 2}
3. ...

What are your thoughts on these?
```

### Phase 5: Finalize

After all open questions are resolved:

1. Update the spec with answers (check off questions, add to changelog)
2. Set status to `in-progress`
3. The spec is now ready for `/plan` or `/feature` to consume

## Spec Quality Checklist

Before presenting the spec, verify:

- [ ] **TLDR** is one paragraph, not a bullet list
- [ ] **Problem Statement** includes a concrete example or scenario
- [ ] **Data Model** uses Carbon conventions (composite PK, audit columns, RLS)
- [ ] **SQL sketches** use `id('prefix')`, not `gen_random_uuid()`
- [ ] **Every architectural heuristic** that applies has a Design Decisions entry
- [ ] **Service function signatures** follow `(client, companyId, ...)` → `{data, error}`
- [ ] **Acceptance criteria** are testable (not vague "works correctly")
- [ ] **Open Questions** section has ≥1 genuine unknown
- [ ] **Risks table** has ≥1 entry
- [ ] **Research notes** are saved to `.ai/scratch/research/`
- [ ] **Changelog** has the creation date entry
- [ ] **File name** follows `{YYYY-MM-DD}-{slug}.md` convention

## Anti-Patterns

- ❌ Writing a spec with zero open questions — means you skipped hard thinking
- ❌ Marking all questions "[x]" yourself without human input — the gate exists
  to force human judgment on ambiguous decisions
- ❌ Copying the template verbatim with `{placeholders}` left in — every section
  must have real content or be explicitly marked N/A with rationale
- ❌ Skipping competitor research — "I already know how ERPs work" is how you
  reinvent a bad version of what SAP solved in 1995
- ❌ Putting "TBD" in the Design Decisions table — if you can't decide, it's an
  Open Question, not a decision
- ❌ Writing acceptance criteria like "feature works as expected" — say exactly
  what "works" means: "user can create a PO with 3 lines and see it in the list
  view with correct totals"

## Output

| Artifact | Location |
|----------|----------|
| Feature spec | `.ai/specs/{YYYY-MM-DD}-{slug}.md` |
| Research notes | `.ai/scratch/research/{feature}.md` |

## Next Steps

After the spec is finalized (all open questions resolved):

- Use `/plan` to create an implementation plan from the spec
- Or use `/feature` to run the full research-to-implementation pipeline
- The spec's acceptance criteria become the binding for `/conductor`
