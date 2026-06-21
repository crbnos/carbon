---
name: plan
description: Create detailed implementation plans from design specs. Use after brainstorming to create step-by-step implementation plans. Each task is 2-5 minutes of work with exact code and commands. Triggers on "plan the implementation", "create a plan for", "write the implementation plan", or after /brainstorm approval.
---

# Plan: Implementation Planning

Transform design specifications into detailed, executable implementation plans. Each task is bite-sized (2-5 minutes) with complete code — no pseudocode, no "fill in details."

**Announce at start:** "I'm using the plan skill to create the implementation plan."

## Prerequisites

Before planning:
1. A design spec exists (from `/brainstorm` or provided by user)
2. The design has been approved
3. Key decisions are documented

If no spec exists, suggest running `/brainstorm` first.

## Workflow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. Load Spec │───▶│ 2. Decompose │───▶│ 3. Write     │───▶│ 4. Review    │
│              │    │ Into Tasks   │    │ Each Task    │    │ & Approve    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

## Step 1: Load the Design Spec

Read the design spec from `.claude/scratch/research/[feature-name]-design.md`.

Extract:
- Data model changes
- Workflows to implement
- Edge cases to handle
- Integration points

## Carbon-Specific References

**IMPORTANT:** Before writing tasks, load these Carbon-specific resources:

| Task Type | Reference | What It Covers |
|-----------|-----------|----------------|
| Database migrations | `.claude/rules/workflow-database-migration.md` | Multi-tenancy, RLS, id(), audit columns, indexes |
| Forms & UI | `/forms` skill | ValidatedForm, zod validators, form components |
| Database writes | `/database-transactions` skill | Kysely transactions, atomic operations |

### Migration Tasks Must Follow

From `.claude/rules/workflow-database-migration.md`:
- Use `id()` for primary keys, not UUID
- Include `companyId` with composite primary key `("id", "companyId")`
- Add standard audit columns (createdBy, createdAt, updatedBy, updatedAt)
- Use standardized RLS policy names (SELECT, INSERT, UPDATE, DELETE)
- Never use `000000` as HHMMSS in migration filename (use random digits)
- Update corresponding `.models.ts` with zod validators

### Form Tasks Must Follow

Invoke `/forms` skill to get:
- ValidatedForm patterns
- Zod validator conventions
- Form component usage
- Action handler patterns

## Step 2: Decompose Into Tasks

### 2.1 Task Granularity

Each task should be **2-5 minutes of work** representing **one discrete action**:

Good task:
```
Task 1: Create lot table migration
- Write migration file
- Run migration
- Verify table exists
```

Bad task:
```
Task 1: Implement lot tracking
- Create tables, services, routes, UI...
```

### 2.2 Task Ordering

Order tasks for TDD:
1. Database migrations
2. Types and interfaces
3. Service layer (with tests)
4. Route handlers (with tests)
5. UI components
6. Integration tests

### 2.3 Dependencies

Identify which tasks depend on others. Independent tasks can be parallelized with subagents.

## Step 3: Write Each Task

For each task, provide:

### 3.1 Files Section

```markdown
**Files:**
- Create: `packages/database/supabase/migrations/NNNN_add_lots.sql`
- Modify: `packages/database/src/types.ts`
- Test: `apps/erp/app/modules/inventory/__tests__/lots.test.ts`
```

### 3.2 Numbered Steps

```markdown
**Steps:**

1. Create migration file at `packages/database/supabase/migrations/20240115120000_add_lot_table.sql`:
   ```sql
   CREATE TABLE lot (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     ...
   );
   ```

2. Run migration:
   ```bash
   pnpm db:migrate
   ```

3. Verify:
   ```bash
   psql -c "SELECT * FROM lot LIMIT 1;"
   # Expected: empty result, no error
   ```

4. Commit:
   ```bash
   git add -A && git commit -m "feat(inventory): add lot table migration"
   ```
```

### 3.3 Requirements

- **Exact file paths** — No "in the appropriate directory"
- **Complete code** — No pseudocode or "add appropriate logic"
- **Exact commands** — With expected output
- **No placeholders** — No TBD, "similar to Task N", or "fill in"

## Step 4: Review & Approve

### 4.1 Save the Plan

Save to `.claude/scratch/plans/[feature-name]-plan.md`:

```markdown
# [Feature] Implementation Plan

## Overview
- **Design Spec:** `.claude/scratch/research/[feature-name]-design.md`
- **Tasks:** N tasks, estimated M minutes
- **Dependencies:** [diagram or list]

## Task 1: [Title]
**Files:**
- ...

**Steps:**
1. ...

## Task 2: [Title]
...
```

### 4.2 Self-Review Checklist

Before presenting:
- [ ] Every task is 2-5 minutes
- [ ] No pseudocode or placeholders
- [ ] All file paths are exact
- [ ] All commands include expected output
- [ ] Tasks follow TDD order
- [ ] Dependencies are clear
- [ ] Migration tasks follow `.claude/rules/workflow-database-migration.md`
- [ ] Form tasks reference `/forms` skill patterns

### 4.3 Get Approval

Present the plan and wait for explicit approval.

## Output

| Artifact | Location |
|----------|----------|
| Implementation plan | `.claude/scratch/plans/[feature-name]-plan.md` |

## Next Step

After approval, hand off to `/execute` to run the plan.

## Plan Format Reference

```markdown
# [Feature] Implementation Plan

## Overview
- **Design Spec:** [path]
- **Research:** [path]
- **Estimated Time:** N tasks × 3 min avg = ~M minutes
- **Branch:** feature/[feature-name]

## Dependencies
Task 2 depends on Task 1 (migration must exist)
Tasks 3-5 are independent (can parallelize)

---

## Task 1: Create database migration

**Files:**
- Create: `packages/database/supabase/migrations/20240115120000_add_X.sql`

**Steps:**

1. Create migration:
   ```sql
   -- Full SQL here
   ```

2. Run:
   ```bash
   pnpm db:migrate
   ```

3. Verify:
   ```bash
   command
   # Expected output
   ```

4. Commit:
   ```bash
   git add -A && git commit -m "feat(module): add X table"
   ```

---

## Task 2: Add TypeScript types
...
```
