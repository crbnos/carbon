---
name: design
description: Research-driven feature design with implementation plan. Combines brainstorming and planning into one flow. Use when designing a new feature. Triggers on "design", "brainstorm", "plan a feature", "how should we build X".
---

# Design: Research-Driven Feature Design

Research competitors → design the feature → create implementation plan → get approval.

**Announce at start:** "I'm using the design skill."

## Workflow

```
┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│ 1. Scope  │───▶│ 2. Research│───▶│ 3. Design │───▶│ 4. Plan   │
└───────────┘    └───────────┘    └───────────┘    └───────────┘
```

## Step 1: Scope

Ask focused questions (max 3-4):
- **What** — Core capability
- **Why** — Problem it solves
- **Where** — ERP, MES, or Academy
- **Who** — Primary users

Classify domain for research:

| Domain | Keywords | Competitors |
|--------|----------|-------------|
| Accounting | GL, AP, AR, invoicing | SAP, NetSuite |
| Manufacturing | Jobs, BOMs, routing | SAP, Epicor |
| MES | Tracking, scheduling | SAP, Manufacturo, First Resonance |
| CNC/Sheet Metal | Quoting, nesting | SAP, Fulcrum, Paperless Parts |
| Quality | Inspection, SPC, FAI | SAP, 1factory, HighQA |
| Inventory | Valuation, lots | SAP, NetSuite, Fishbowl |

## Step 2: Research

Invoke `/research [feature]` to survey competitors.

Save to `llm/research/[feature].md`.

## Step 3: Design

With research in hand, design the feature:

### 3.1 Design Decisions

For each decision:
1. State the question
2. Reference research — "SAP and NetSuite both..."
3. Recommend approach

### 3.2 Write Spec

Save to `docs/specs/[feature]-design.md`:

```markdown
# [Feature] Design

## Summary
[One paragraph]

## Research
Key findings from [llm/research/[feature].md]:
- [Pattern 1]
- [Pattern 2]

## Decisions

### [Decision 1]
**Question:** ...
**Industry:** ...
**Our Approach:** ...

## Data Model
[Tables, columns, relationships]

## Workflows
[User journeys, state transitions]

## Edge Cases
[Tricky stuff, informed by competitors]
```

## Step 4: Plan

Create implementation plan in `llm/tasks/[feature]-plan.md`.

### Load Conventions

Before writing tasks, load from `llm/conventions/`:
- `database.md` — Migrations, RLS, transactions
- `forms.md` — ValidatedForm, validators, actions
- `services.md` — Service function patterns
- `ui.md` — Components, polish

### Task Structure

Each task is **2-5 minutes**, one discrete action:

```markdown
## Task 1: Create migration

**Files:**
- Create: `packages/database/supabase/migrations/20240115041739_add_thing.sql`

**Steps:**
1. Create migration following `llm/conventions/database.md`
2. Run: `npm run db:build`
3. Commit
```

### Task Order

1. Database migrations
2. Types and validators
3. Service functions
4. Route handlers
5. UI components
6. Tests

## Output

| Artifact | Location |
|----------|----------|
| Research | `llm/research/[feature].md` |
| Design spec | `docs/specs/[feature]-design.md` |
| Implementation plan | `llm/tasks/[feature]-plan.md` |

## Approval Gate

Present spec and plan together. Wait for explicit approval before handing off to `/execute`.

## When to Stop

- Feature is more complex than expected
- Research reveals conflicting patterns
- Need business input (not just technical)
