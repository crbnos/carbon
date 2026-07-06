---
name: research
description: Survey best practices from competitor ERPs and point solutions for a given feature. Use when designing new features, evaluating approaches, or understanding industry patterns. Triggers on "research best practices", "how do competitors do X", "survey the market for Y", "what's the industry standard for", or any request to understand how other systems handle a feature.
---

# Research: Competitor Best Practices

Survey how best-in-class ERPs and point solutions implement a feature. Carbon spans accounting, manufacturing, MES, quality, and more — this skill ensures we research the **right** competitors for each domain, not just any ERP.

## Domain-to-Competitor Mapping

| Domain | Always | Primary Competitors | Keywords |
|--------|--------|---------------------|----------|
| **Accounting** | SAP | NetSuite | GL, AP, AR, invoicing, payments, accruals, journal entries, financial reports |
| **Discrete Manufacturing** | SAP | Epicor | Job shops, work orders, BOMs, routing, shop floor, job costing |
| **MES / Production Tracking** | SAP | Manufacturo, First Resonance | Real-time tracking, IoT, machine monitoring, production scheduling, dispatch |
| **CNC Parts / Sheet Metal** | SAP | Fulcrum, Paperless Parts | Quoting, estimating, nesting, machine-specific routing, RFQ |
| **Quality** | SAP | 1factory, HighQA | Inspection, SPC, compliance, FAI, PPAP, measurement, GD&T |
| **Inventory** | SAP | NetSuite, Fishbowl | Valuation, lot tracking, cycle counting, warehouse, locations |
| **Sales / CRM** | SAP | NetSuite, Salesforce | Quotes, orders, customers, pricing, commissions |
| **Purchasing** | SAP | NetSuite, Coupa | POs, suppliers, receiving, vendor management, procurement |
| **Unknown** | SAP | *(discover first)* | First search for "best [domain] software" to identify leaders |

**SAP is always included** — it's the gold standard for enterprise patterns, even when point solutions are more innovative.

## Workflow

### Step 1: Classify the Domain

Read the feature request and match it to domains above using keywords. A feature may span multiple domains (e.g., "shop floor quality inspections" → MES + Quality).

### Step 2: Identify Competitors to Research

1. **Always include SAP** for any feature
2. **Add domain-specific competitors** from the mapping table
3. **For unknown domains**: First search `best [domain] software 2025` to identify 2-3 leaders before deep research

### Step 3: Execute Targeted Searches

For each competitor, search for:
- `[Competitor] [feature] documentation`
- `[Competitor] [feature] how it works`
- `[Competitor] [feature] best practices`

Example for "inventory valuation":
- `SAP S/4HANA inventory valuation methods`
- `NetSuite inventory costing FIFO LIFO average`
- `SAP inventory valuation configuration`

### Step 4: Synthesize Findings

Structure research as actionable patterns:

1. **Key Consensus** — What all/most competitors agree on (these are likely industry requirements)
2. **Competitor-Specific Details** — Unique approaches worth noting
3. **Recommended Approach** — What Carbon should do, citing which competitor patterns to follow

### Step 5: Save Output

Save the research to `llm/research/[feature-slug].md` using the output format below.

## Output Format

```markdown
# [Feature] Research: Best Practices Survey

## Summary
One paragraph describing what was researched and key findings.

## Competitors Surveyed
- **SAP S/4HANA** — [why relevant]
- **[Competitor]** — [why relevant]

## Key Consensus Patterns

### 1. [Pattern Name]
- **SAP**: [how SAP does it]
- **[Competitor]**: [how they do it]
- **Rationale**: [why this is the standard]

### 2. [Pattern Name]
...

## Competitor-Specific Details

### SAP
[Notable implementation details, configuration options, terminology]

### [Competitor]
[Notable implementation details, unique approaches]

## Recommended Approach for Carbon

Based on the research:
1. [Recommendation with rationale]
2. [Recommendation with rationale]

## Sources
- [Link 1]
- [Link 2]
```

## Example Research

See `llm/tasks/accrual-accounting-research.md` for an example of well-structured competitor research covering NetSuite and SAP accounting patterns.

## When to Use

- Designing a new feature and want to understand industry patterns
- Evaluating multiple approaches and want to see what competitors chose
- Building domain knowledge before implementation
- Validating that a proposed design matches industry standards

## Tips

- **Be specific**: "inventory valuation for job costing" yields better results than just "inventory"
- **Cross-domain features**: Research all relevant domains (e.g., "shop floor inspections" → MES + Quality)
- **Unknown domains**: Don't guess competitors — search for "best [domain] software" first
- **Focus on patterns, not UI**: We want to understand the underlying data model and workflows, not copy screens
