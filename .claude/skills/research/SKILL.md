---
name: research
description: Survey how best-in-class ERPs and point solutions implement a feature, and produce a findings file at .ai/research/{slug}.md. Use when designing a new feature, evaluating approaches, or answering "how do competitors / SAP / the industry do X". Required before designing any ERP-domain feature (accounting, costing, tax, inventory valuation, RMA, MRP, etc.). Do not use for UI styling questions (copy an existing Carbon screen instead) or for bugs (use root-cause).
---

# research — competitor best-practice survey

Input: a feature or domain question. Output: `.ai/research/{feature-slug}.md` with
consensus patterns and a recommendation for Carbon. This skill only researches and
writes the findings file — it does not design, plan, or write code.

**Announce at start:** "Using the research skill — surveying how competitors
handle {feature}."

## Step 1: Classify the domain

Match the request against this table. A feature may match multiple rows (e.g.
"shop floor inspections" → MES + Quality). Research every matching row.

| Domain | Always | Also research | Keywords |
|--------|--------|---------------|----------|
| Accounting | SAP | NetSuite | GL, AP, AR, invoicing, payments, accruals, journal entries, period close, financial reports |
| Discrete manufacturing | SAP | Epicor | job shops, work orders, BOMs, routing, job costing |
| MES / production tracking | SAP | Manufacturo, First Resonance | real-time tracking, dispatch, machine monitoring, scheduling |
| CNC parts / sheet metal | SAP | Fulcrum, Paperless Parts | quoting, estimating, nesting, RFQ |
| Quality | SAP | 1factory, HighQA | inspection, SPC, FAI, PPAP, GD&T, NCR |
| Inventory | SAP | NetSuite, Fishbowl | valuation, lots, cycle counting, warehouses |
| Sales / CRM | SAP | NetSuite, Salesforce | quotes, orders, pricing, commissions |
| Purchasing | SAP | NetSuite, Coupa | POs, suppliers, receiving, procurement |
| Anything else | SAP | discover first | search `best <domain> software` and pick the top 2 leaders before deep research |

SAP is always included — it is the reference for enterprise patterns even when
point solutions are more innovative.

## Step 2: Write the research questions

Before searching, list 3–6 concrete questions the design will need answered.
Prefer data-model and workflow questions over UI questions:

- What entities and status lifecycles does the competitor use?
- What edge cases do they handle that we might miss?
- Is there an industry-standard term we should adopt instead of inventing one?

## Step 3: Search

For each competitor, run searches shaped like:

- `<Competitor> <feature> documentation`
- `<Competitor> <feature> how it works`
- `<Competitor> <feature> best practices`

Rules:

- Be specific: `SAP S/4HANA inventory valuation methods`, not `SAP inventory`.
- Fan searches out to subagents (one competitor or one question per subagent) to
  keep the main context clean. Each subagent returns findings + source URLs only.
- End every subagent prompt with: "Write your report in STE-80
  (`.claude/rules/writing-ste.md`): short sentences, active voice, no 'etc.'."
  This makes the rewrite in Step 4 smaller. It does not replace that rewrite.
- Focus on data models, workflows, and terminology — not screenshots or UI copy.

## Step 4: Write the findings file

> 🛑 Write every sentence in STE-80 from the first draft (`.claude/rules/writing-ste.md` → Write-time habits). Never ask the human to check the style.
>
> Subagent reports are raw material. Never paste one into the findings file
> as it is. Rewrite each finding in STE-80 (`.claude/rules/writing-ste.md`)
> before it goes in. Use one term per concept across all competitors.

Save to `.ai/research/{feature-slug}.md` (kebab-case slug). Use exactly this
structure:

```markdown
# {Feature} Research: Best Practices Survey

## Summary
One paragraph: what was researched, key findings.

## Competitors Surveyed
- **SAP S/4HANA** — {why relevant}
- **{Competitor}** — {why relevant}

## Key Consensus Patterns
### 1. {Pattern name}
- **SAP**: {how SAP does it}
- **{Competitor}**: {how they do it}
- **Rationale**: {why this is the standard}

## Answers to Research Questions
1. {Question} — {answer, citing which competitor}

## Competitor-Specific Details
### {Competitor}
{notable configuration options, terminology, unique approaches}

## Recommended Approach for Carbon
1. {Recommendation with rationale, naming the competitor pattern it follows}

## Sources
- {URL}
```

## Step 5: Do the STE-80 review pass

Do the STE-80 review pass (`.claude/rules/writing-ste.md` → Enforcement) on
`.ai/research/{feature-slug}.md`. Do it after the last subagent result is
merged, and again after any later edit.

1. Follow the 8 steps of the review pass in that rule, in order.
2. Check every merged finding against its subagent report. A rewrite must not
   turn a claim about one product into a claim about all products.
3. Tick every box of the rule's self-check list.

If a box still fails after 3 rewrite passes, STOP and report the failing lines.

## Done when

- [ ] Every matching domain row was researched, SAP included
- [ ] Every research question from Step 2 has an answer (or is explicitly marked
      unanswered — carry it into the spec's Open Questions)
- [ ] The findings file exists at `.ai/research/{slug}.md` with all sections filled
- [ ] Every claim has a source URL in the Sources section
- [ ] The STE-80 review pass is done after the last edit, and every self-check box is ticked

## Next step

Hand the findings file to `/spec-writing` (design + spec) or cite it from an
existing spec. Do not start implementation from research alone.
