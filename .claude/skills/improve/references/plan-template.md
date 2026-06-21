# Handoff Plan Template (Carbon)

Every plan is written for an executor model that has **zero context**: it has not seen the advisor session, the audit, the other plans, `.claude/rules/`, or any prior conversation. It may be a smaller/cheaper model. Assume it is competent at following explicit instructions and weak at filling gaps, recovering from ambiguity, or knowing when to stop.

Three properties make a plan executable by a weaker model:

1. **Self-contained context** — everything needed is in the file: paths, code excerpts, the relevant Carbon convention quoted inline, commands.
2. **Verification gates** — every step ends with a command and its expected result. The executor never has to *judge* whether it succeeded.
3. **Hard boundaries and escape hatches** — explicit out-of-scope list, and "STOP and report" conditions instead of letting the model improvise when reality doesn't match the plan.

File naming: `.claude/scratch/plans/improve/NNN-short-slug.md`, numbered in recommended execution order.

**Carbon command rules the plan must respect** (bake into every plan):
- Typecheck is **scoped to one package**: `turbo run typecheck --filter=<pkg>`. NEVER a whole-repo typecheck (it OOMs).
- Lint read-only: `pnpm exec biome lint <paths>`. Format only if the plan explicitly intends it: `pnpm exec biome format --write <paths>`.
- Tests: `pnpm --filter <pkg> test` (vitest).
- **The executor never runs database migrations/seeds/rebuilds** (`pnpm db:migrate`, `db:seed`, `db:types`, `crbn migrate`). If a plan adds a migration, the executor writes the SQL file per `.claude/rules/workflow-database-migration.md`; **the user applies it**. State this explicitly.

---

## Template

```markdown
# Plan NNN: <Imperative title — what will be true after this plan>

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `.claude/scratch/plans/improve/README.md` — unless a reviewer dispatched you and told
> you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat <planned-at SHA>..HEAD -- <in-scope paths>`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 | P2 | P3
- **Effort**: S | M | L
- **Risk**: LOW | MED | HIGH
- **Depends on**: .claude/scratch/plans/improve/NNN-*.md (or "none")
- **Category**: bug | security | perf | tests | tech-debt | migration | dx | docs | direction
- **Planned at**: commit `<short SHA>`, <YYYY-MM-DD>
- **Issue**: <GitHub issue URL — only when published via `--issues`; omit otherwise>

## Why this matters

2–5 sentences. The problem, its concrete cost, and what improves when this
lands. Intent is what lets a correct judgment call happen when a detail is off.

## Current state

The facts the executor needs, inlined — never "as discussed" or "see the cache":

- The relevant files, each with one line on its role:
  - `apps/erp/app/modules/inventory/services/picking.ts` — picking-list service; contains the N+1 (lines 130–160)
- Excerpts of the code as it exists today (short, with `file:line` markers),
  enough that the executor can confirm it's looking at the right thing.
- The Carbon conventions that apply, **quoted inline** (the executor has not read
  `.claude/rules/conventions-*` or `.claude/rules/`), with a pointer to one exemplar file:
  "Service functions return `{ data, error }` and use Kysely transactions for
  multi-row writes — see `<exemplar>.service.ts` and match it."
- Any schema/migration constraints inlined from `.claude/rules/workflow-database-migration.md`
  if the plan touches the database.

## Commands you will need

| Purpose       | Command                                      | Expected on success     |
|---------------|----------------------------------------------|-------------------------|
| Install       | `pnpm install`                               | exit 0                  |
| Typecheck     | `turbo run typecheck --filter=<pkg>`         | exit 0, no errors       |
| Lint          | `pnpm exec biome lint <in-scope paths>`      | exit 0, no diagnostics  |
| Tests         | `pnpm --filter <pkg> test`                   | all pass                |
| Single test   | `pnpm --filter <pkg> exec vitest run <file>` | target tests pass       |

(Exact commands for the in-scope package — verified during recon, not guessed.
NEVER `pnpm typecheck` / `turbo run typecheck --filter='*'` — whole-repo typecheck OOMs.
NEVER run DB migrate/seed/rebuild commands.)

## Suggested executor toolkit

(Optional — include only when relevant skills/tools plausibly exist in the
executor's environment. Skip the section otherwise.)

- Carbon skills the executor should invoke if available, and for what:
  "use the `forms` skill when adding the validator in step 2";
  "use the `database-transactions` skill for the atomic write in step 3".
- Workflow docs worth reading first by path:
  "`.claude/rules/workflow-database-migration.md` before writing the migration in step 4".

## Scope

**In scope** (the only files you should modify):
- `apps/erp/app/modules/inventory/services/picking.ts`
- `<corresponding test file>` (create)

**Out of scope** (do NOT touch, even though they look related):
- Generated files: `packages/database/src/types.ts`, Lingui `*.mjs`, `.react-router/`.
- Any change to a public service-function signature consumed by other modules — list them.
- The database itself — do not run migrations even if the plan creates one.

## Git workflow

(Filled from recon — match the repo's observed conventions.)

- Branch: `improve/NNN-<slug>` (Carbon uses `feat/*` / `fix/*`; this is advisor work).
- Conventional commits (`fix: …`, `feat: …`), one per step or logical unit — match `git log`.
- Do NOT push, open a PR, or merge unless the operator instructed it. Per `AGENTS.md`,
  commits happen only when explicitly requested.

## Steps

### Step 1: <imperative title>

What to do, precisely. Reference exact files/symbols. Include the target code
shape when it's load-bearing.

**Verify**: `<scoped command>` → <expected output>

### Step 2: ...

(Each step small enough to verify independently. Order steps so the codebase is
never broken between steps — e.g. add new path, switch callers, then remove old path.)

## Test plan

- New tests to write, in which package (one that already has vitest, or note the
  setup cost if not), covering which cases (happy path, the specific bug/regression,
  named edge cases).
- Which existing test to use as the structural pattern: "model after `<file>.test.ts`".
- Verification: `pnpm --filter <pkg> test` → all pass, including N new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `turbo run typecheck --filter=<pkg>` exits 0
- [ ] `pnpm --filter <pkg> test` exits 0; new tests for <X> exist and pass
- [ ] `pnpm exec biome lint <in-scope paths>` reports no diagnostics
- [ ] `grep -rn "<old pattern>" <in-scope dir>` returns no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `.claude/scratch/plans/improve/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the "Current state" locations doesn't match the excerpts (drift).
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.
- The change requires applying a database migration to verify (the user does that, not you).
- You discover the assumption "<key assumption>" is false.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- What future changes will interact with this.
- What a reviewer should scrutinize in the PR.
- Whether a `.claude/rules/` doc should be updated **after this is committed** (note it;
  do not update the rules as part of this plan — the rules are for committed code only).
- Any follow-up explicitly deferred out of this plan (and why).
```

---

## Index file: `.claude/scratch/plans/improve/README.md`

Written once by the advisor after all plans, updated by executors:

```markdown
# Improve — Implementation Plans

Generated by the `improve` skill on <date>. Execute in the order below unless
dependencies say otherwise. Each executor: read the plan fully before starting,
honor its STOP conditions, and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | ...   | P1       | S      | —          | TODO   |
| 002  | ...   | P1       | M      | 001        | TODO   |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) | REJECTED (one-line rationale)

## Dependency notes

- 002 requires 001 because <reason>.

## Findings considered and rejected

- <finding>: not worth doing because <one line>. (So nobody re-audits it.)
```

## Quality bar — check before finishing each plan

- Could a model that has never seen this repo or `.claude/rules/` execute this with only the plan file and the repo? If any step needs knowledge from the advisor session or the rules, inline it.
- Is every verification a command with an expected result, not a judgment ("make sure it works")?
- Is every typecheck **scoped to a package** (never whole-repo)? Does no step run a DB migrate/seed/rebuild?
- Does every step name exact files and symbols?
- Are the STOP conditions specific to this plan's actual risks, not boilerplate?
- Would a reviewer reading only "Why this matters" + "Done criteria" understand what they're approving?
- No secret values anywhere — locations and credential types only.
- "Planned at" SHA is filled in and the in-scope paths in the drift check match the Scope section.
