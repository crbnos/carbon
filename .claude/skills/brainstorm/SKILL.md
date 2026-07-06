---
name: brainstorm
description: Research-driven brainstorming for feature design. Use when designing a new feature, exploring approaches, or making design decisions. Automatically researches competitors before asking design questions. Triggers on "brainstorm", "design a feature", "how should we build X", or any request to explore approaches for a feature.
---

# Brainstorm: Research-Driven Design

Transform feature ideas into well-researched designs. Unlike traditional brainstorming that asks endless questions, this skill **researches competitors first** so design decisions are informed by industry patterns.

**Announce at start:** "I'm using the brainstorm skill to design this with research."

## The Problem This Solves

Traditional brainstorming:
```
Claude: "How should we handle partial shipments?"
User:  "Good question, how does SAP do it?"
Claude: [researches]
Claude: "What about backorders?"
User:  "How does NetSuite handle that?"
Claude: [researches again]
... repeat 10 times ...
```

This skill front-loads that research.

## Workflow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. Scope     │───▶│ 2. Research  │───▶│ 3. Design    │───▶│ 4. Document  │
│    Feature   │    │ Competitors  │    │ With Data    │    │ & Approve    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

## Step 1: Scope the Feature

### 1.1 Understand the Request

Ask focused questions (max 3-4) to understand:
- **What** — The core capability
- **Why** — The problem it solves
- **Where** — Which part of Carbon (ERP, MES, Academy)
- **Who** — Primary users

### 1.2 Classify the Domain

Map to research domains:

| Domain | Keywords | Competitors |
|--------|----------|-------------|
| Accounting | GL, AP, AR, invoicing, payments | SAP, NetSuite |
| Manufacturing | Jobs, work orders, BOMs, routing | SAP, Epicor |
| MES | Real-time tracking, scheduling, dispatch | SAP, Manufacturo, First Resonance |
| CNC/Sheet Metal | Quoting, estimating, nesting | SAP, Fulcrum, Paperless Parts |
| Quality | Inspection, SPC, FAI, GD&T | SAP, 1factory, HighQA |
| Inventory | Valuation, lots, warehousing | SAP, NetSuite, Fishbowl |
| Sales | Quotes, orders, pricing | SAP, NetSuite |
| Purchasing | POs, suppliers, receiving | SAP, NetSuite, Coupa |

### 1.3 Identify Research Questions

Before researching, list the key design questions:

```markdown
## Research Questions for [Feature]
1. [Data model question]
2. [Workflow question]
3. [Edge case question]
4. [Integration question]
```

## Step 2: Research Competitors

### 2.1 Execute Research

Invoke `/research [feature]` targeting the identified questions.

Search patterns per competitor:
- `[Competitor] [feature] documentation`
- `[Competitor] [feature] workflow`
- `[Competitor] [feature] best practices`

### 2.2 Synthesize

Structure findings as:
1. **Key Consensus** — What all competitors agree on
2. **Unique Approaches** — Interesting variations
3. **Answers to Questions** — Direct answers from Step 1.3

Save to `llm/research/[feature-slug].md`.

## Step 3: Design With Data

Now brainstorm **with research in hand**.

### 3.1 For Each Design Decision

1. **State the question**
2. **Reference the research** — "SAP and NetSuite both..."
3. **Propose 2-3 approaches** with trade-offs
4. **Recommend one** based on industry patterns

### 3.2 Cover These Areas

- **Data Model** — Tables, relationships, key fields
- **Workflows** — User journeys, state transitions
- **Edge Cases** — How competitors handle the tricky stuff
- **Integration** — How this connects to existing Carbon features

## Step 4: Document & Approve

### 4.1 Write Design Spec

Save to `docs/specs/[feature-name]-design.md`:

```markdown
# [Feature] Design Specification

## Summary
[One paragraph]

## Research Summary
[Key findings, link to full research]

## Design Decisions

### [Decision 1]
**Question:** [The design question]
**Industry Pattern:** [What competitors do]
**Our Approach:** [What we'll do and why]

## Data Model
[Schema]

## Workflows
[User journeys]

## Edge Cases
[Tricky stuff, informed by competitors]
```

### 4.2 Self-Review

Before presenting to user:
- [ ] No placeholders or TBDs
- [ ] All research questions answered
- [ ] Data model complete
- [ ] Edge cases addressed

### 4.3 Get Approval

Present the spec and wait for explicit approval before proceeding.

## Output

| Artifact | Location |
|----------|----------|
| Competitor research | `llm/research/[feature-slug].md` |
| Design specification | `docs/specs/[feature-name]-design.md` |

## Next Step

After approval, hand off to `/plan` to create the implementation plan.

## When to Stop and Ask

- Feature is more complex than expected
- Decisions require business input (not just technical)
- Research reveals conflicting patterns with no clear winner
- Uncertain about something that affects other Carbon modules
