---
name: execute
description: Execute implementation plans task by task with verification. Use after /plan to implement the feature. Follows each task exactly, runs verifications, commits frequently. Triggers on "execute the plan", "implement the plan", "run the plan", or after /plan approval.
---

# Execute: Plan Implementation

Execute implementation plans task by task. Follow each step exactly, run all verifications, commit after each task.

**Announce at start:** "I'm using the execute skill to implement this plan."

## Prerequisites

Before executing:
1. An implementation plan exists (from `/plan`)
2. The plan has been approved
3. You're on the correct branch

If no plan exists, suggest running `/plan` first.

## Workflow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. Load Plan │───▶│ 2. Execute   │───▶│ 3. Verify    │───▶│ 4. Complete  │
│ & Review     │    │ Each Task    │    │ & Commit     │    │ & Review     │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

## Step 1: Load Plan & Review

### 1.1 Load the Plan

Read `.claude/scratch/plans/[feature-name]-plan.md`.

### 1.2 Critical Review

Before starting, check:
- [ ] Plan makes sense
- [ ] No obvious gaps
- [ ] Dependencies are clear
- [ ] On correct branch

If concerns exist, raise them before proceeding.

### 1.3 Create Progress Tracker

Track progress in `.claude/scratch/tasks/todo.md`:

```markdown
## [Feature] Implementation

- [ ] Task 1: [Title]
- [ ] Task 2: [Title]
...
```

## Carbon-Specific Skills to Load

When executing tasks, load the appropriate Carbon skill for guidance:

| Task Type | Skill/Workflow | Load When |
|-----------|----------------|-----------|
| Database migrations | `.claude/rules/workflow-database-migration.md` | Creating tables, columns, RLS |
| Forms & validators | `/forms` skill | Building UI forms |
| Multi-row writes | `/database-transactions` skill | Bulk updates, atomic operations |
| UI polish | `/make-interfaces-feel-better` skill | Animations, shadows, typography |

**For migrations:** Read `.claude/rules/workflow-database-migration.md` before writing SQL to ensure:
- `id()` function for primary keys
- `companyId` with composite primary key
- Standardized RLS policies (SELECT, INSERT, UPDATE, DELETE)
- Audit columns (createdBy, createdAt, updatedBy, updatedAt)

**For forms:** Invoke `/forms` to get ValidatedForm patterns, zod conventions, and action handlers.

## Step 2: Execute Each Task

For each task:

### 2.1 Mark In Progress

Update `.claude/scratch/tasks/todo.md`:
```markdown
- [x] Task 1: Create migration ✓
- [ ] Task 2: Add types (in progress)
- [ ] Task 3: Service layer
```

### 2.2 Follow Steps Exactly

The plan has bite-sized steps. Follow them exactly:
- Use the exact file paths
- Use the exact code
- Run the exact commands

### 2.3 Run Verifications

Every task has verification steps. Run them all:
- Tests must pass
- Commands must produce expected output
- TypeScript must compile

### 2.4 Commit

After task passes verification:
```bash
git add [specific files] && git commit -m "[type](module): [description]"
```

### 2.5 Mark Complete

Update tracker and move to next task.

## Step 3: Handle Blockers

### When to Stop

**Stop immediately when:**
- Test fails and you can't quickly fix it
- Plan has a gap (missing step or unclear instruction)
- Verification produces unexpected output
- You need to make a decision not covered by the plan

### What to Do

1. **Don't guess** — Stop and ask
2. **Document the blocker** — What happened, what you tried
3. **Propose options** — If you have ideas, share them

### After Blocker Resolution

Return to the task and continue.

## Step 4: Complete & Review

### 4.1 Final Verification

After all tasks:
- [ ] All tests pass: `pnpm test`
- [ ] TypeScript compiles: `pnpm typecheck`
- [ ] Lint passes: `pnpm lint`

### 4.2 Feature Verification

Use `/verify` to test the feature in the browser:
- Happy path works
- Edge cases handled
- No regressions

### 4.3 Self-Review

Use `/self-review` to check your work before declaring done.

### 4.4 Report Completion

```markdown
## Implementation Complete

**Branch:** feature/[name]
**Commits:** N commits
**Tests:** X new tests, all passing

**Summary:**
- [What was built]
- [Key decisions made during implementation]
- [Any deviations from plan and why]

**Ready for:** PR creation / further review
```

## Subagent Strategy

For plans with independent tasks, consider dispatching subagents:

```markdown
## Parallelizable Tasks

Tasks 3, 4, 5 are independent (all depend only on Task 2).
Dispatch 3 subagents in parallel:
- Subagent A: Task 3
- Subagent B: Task 4  
- Subagent C: Task 5
```

Use the Agent tool with clear context for each subagent.

## Output

| Artifact | Location |
|----------|----------|
| Working code | Feature branch |
| Progress tracker | `.claude/scratch/tasks/todo.md` |
| Commits | Git history |

## Next Steps

After execution:
- Create PR (if ready)
- Run `/self-review`
- Use `/verify` for browser testing
