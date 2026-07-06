---
name: feature
description: End-to-end feature development orchestrator. Composes /research, /brainstorm, /plan, and /execute into a single workflow. Use when building a new feature from scratch. Triggers on "build a feature", "implement X from scratch", "full feature development for Y".
---

# Feature: End-to-End Development Orchestrator

Orchestrates the full feature development lifecycle by composing smaller skills:

```
/research → /brainstorm → /plan → /execute → /verify
```

**Announce at start:** "I'm using the feature skill to orchestrate end-to-end development."

## When to Use This vs Individual Skills

| Use `/feature` when... | Use individual skills when... |
|------------------------|-------------------------------|
| Building something new from scratch | You only need one phase |
| Want the full research-to-implementation flow | Design already exists |
| Don't want to invoke each skill manually | Plan already exists |

## The Pipeline

### Phase 1: Research (`/research`)

Identify the domain and research competitors:
- SAP (always)
- Domain-specific best-in-class competitors
- Save to `llm/research/[feature].md`

### Phase 2: Brainstorm (`/brainstorm`)

Design with research in hand:
- Use competitor patterns to inform decisions
- Document design choices with rationale
- Save to `docs/specs/[feature]-design.md`
- **Gate:** User approval required

### Phase 3: Plan (`/plan`)

Create implementation plan:
- Break into 2-5 minute tasks
- Complete code, no pseudocode
- Save to `llm/tasks/[feature]-plan.md`
- **Gate:** User approval required

### Phase 4: Execute (`/execute`)

Implement the plan:
- Follow each task exactly
- Run verifications
- Commit after each task

### Phase 5: Verify (`/verify`)

Test in browser:
- Happy path
- Edge cases
- No regressions

## Usage

```
User: /feature lot tracking for inventory

Claude: I'm using the feature skill to orchestrate end-to-end development.

Phase 1: Research
[Invokes /research inventory lot tracking]
[Saves to llm/research/lot-tracking.md]

Phase 2: Brainstorm  
[Invokes /brainstorm with research context]
[Presents design spec]
[Waits for approval]

Phase 3: Plan
[Invokes /plan]
[Presents implementation plan]
[Waits for approval]

Phase 4: Execute
[Invokes /execute]
[Implements each task]

Phase 5: Verify
[Invokes /verify]
[Tests feature]
```

## Artifacts Produced

| Phase | Artifact | Location |
|-------|----------|----------|
| Research | Competitor analysis | `llm/research/[feature].md` |
| Brainstorm | Design spec | `docs/specs/[feature]-design.md` |
| Plan | Implementation plan | `llm/tasks/[feature]-plan.md` |
| Execute | Working code | Feature branch |
| Verify | Test evidence | Screenshots/logs |

## Composable Skills

Each phase uses a standalone skill you can invoke directly:

- `/research [topic]` — Survey competitor best practices
- `/brainstorm [feature]` — Research-driven design
- `/plan [feature]` — Create implementation plan
- `/execute [feature]` — Implement from plan
- `/verify` — Test feature in browser
- `/self-review` — Review before PR

## Skipping Phases

If you already have artifacts, skip to the appropriate phase:

- Have research? Start with `/brainstorm`
- Have design spec? Start with `/plan`  
- Have plan? Start with `/execute`
