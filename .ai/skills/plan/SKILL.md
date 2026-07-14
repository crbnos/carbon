---
name: plan
description: Turn a finalized spec into a step-by-step implementation plan at .ai/plans/{YYYY-MM-DD}-{slug}.md, where every task has exact file paths, exact commands, and a verification with expected output. Use when asked to "plan the implementation", "create a plan", or after a spec's open questions are resolved. Do not use while the spec still has unresolved open questions, and do not use it to design — design happens in /spec-writing.
---

# plan — implementation plan from a spec

Input: a finalized spec (`.ai/specs/{date}-{slug}.md` with zero unresolved open
questions) or, for small changes, an explicit user description. Output: a plan at
`.ai/plans/{YYYY-MM-DD}-{slug}.md` that `/execute` can follow mechanically.

Write the plan for the **weakest plausible executor**: an agent with no memory of
this session. Every task must be executable from the plan text alone.

**Announce at start:** "Using the plan skill — turning the spec into an
implementation plan."

## Step 1: Check prerequisites

1. Read the spec. If any Open Question is unchecked → **STOP** and return to
   `/spec-writing` Step 7. Do not plan around an open question.
2. Read `.ai/lessons.md` and the module `AGENTS.md` for every module the spec
   touches.
3. Read the matching guides for the work in the plan (from the root `AGENTS.md`
   Task Router). At minimum:
   - migrations → `.ai/rules/workflow-database-migration.md`
   - services → `.ai/rules/conventions-services.md`
   - forms/UI → `.ai/rules/conventions-forms.md` + `packages/form/AGENTS.md`
   - database access → `.ai/rules/database-patterns.md`

## Step 2: Decompose into tasks

- One task = one verifiable unit of work (a migration, a service function + its
  test, a route + form, a UI component). If a task can't be verified by a single
  command or a single browser check, split it.
- Default order: migration → `pnpm run generate:types` → models (zod) → service
  functions (+ unit tests) → routes/actions → UI → browser verification.
- For every UI task, name the **precedent**: the existing Carbon screen or
  component to copy from (file path). Do not design UI from concepts — grep
  `packages/react/src/` and `apps/erp/app/components/` first.
- Mark tasks that are independent of each other — `/execute` may run them as
  parallel subagents.

## Step 3: Write each task

Every task uses exactly this shape:

````markdown
## Task N: {imperative title}

**Depends on:** {task numbers, or "none"}
**Files:**
- Create: `{exact path}`
- Modify: `{exact path}` — {what changes}
- Copy from (precedent): `{exact path of the exemplar}`

**Steps:**
1. {exact instruction; include full SQL for migrations, function signatures for
   services, and the exemplar to copy for UI}
2. ...

**Verify:**
```bash
{exact command}
# Expected: {what the output must contain}
```

**Out of scope:** {things that look related but must NOT be touched}
````

Hard rules for task content:

- **Migrations**: create with `pnpm db:migrate:new <name>` (never hand-pick a
  timestamp; never `000000` as HHMMSS). SQL must use `id('prefix')` defaults,
  `companyId` + composite PK `("id", "companyId")`, audit columns
  (`createdBy/createdAt/updatedBy/updatedAt`), RLS policies per
  `.ai/rules/conventions-database.md`, and be idempotent (`IF NOT EXISTS` /
  `DROP ... IF EXISTS` guards). Never backdate a timestamp older than the newest
  migration on `main`. The task after any migration is always
  `pnpm run generate:types`.
- **Verification is scoped.** Typecheck a package with
  `pnpm exec turbo run typecheck --filter=<pkg>` (e.g. `--filter=erp`,
  `--filter=@carbon/react`). Never plan a whole-repo `pnpm typecheck` — it OOMs.
  Tests: `pnpm --filter <pkg> test`.
- **No placeholders.** No "TBD", no "similar to Task 3", no "add appropriate
  logic". If you can't specify it, the spec is incomplete — go back.
- **Escape hatches.** Where a task rests on an assumption, add: "If {assumption}
  turns out false, STOP and report — do not improvise."

Red flags — if you catch yourself writing any of these, the task is
under-specified; fix it before moving on:

- "similar to the previous task" / "as appropriate" / "etc."
- a Verify block with no expected output
- a UI task with no precedent file path
- a migration task without a `generate:types` follow-up

## Step 4: Write the plan file

Save to `.ai/plans/{YYYY-MM-DD}-{slug}.md` (today's date, same slug as the spec):

```markdown
# {Feature} — implementation plan

**Spec:** .ai/specs/{date}-{slug}.md
**Research:** .ai/research/{slug}.md
**Branch:** {branch name}

## Progress
- [ ] Task 1: {title}
- [ ] Task 2: {title}

## Dependencies
{`Task 2 needs Task 1 (types)`, `Tasks 4–5 independent`}

---
{tasks}
```

The Progress checklist is the live tracker — `/execute` checks items off in this
file. Do not create a separate todo file.

## Step 5: Self-check, then present

- [ ] Every task has exact paths, exact commands, expected output
- [ ] Every migration task follows the hard rules above and is followed by a
      `generate:types` step
- [ ] Every UI task names its precedent file
- [ ] No whole-repo typecheck anywhere in the plan
- [ ] Every acceptance criterion in the spec is covered by at least one task,
      and the final task is browser verification via `/test` for user-facing work

Present the plan path and a one-paragraph summary. Wait for approval, then hand
off to `/execute`.
