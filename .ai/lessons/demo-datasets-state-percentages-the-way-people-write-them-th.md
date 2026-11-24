---
paths: []
triggers: []
promoted: null
---
# Demo datasets state percentages the way people write them; the tier converts

**Context:** `PricingRuleSpec.amount` is documented and validated as percent points
(0–100], but tier 02 inserted it into `pricingRule.amount` unchanged.

**Problem:** the pricing engine multiplies by a fraction (`price × amount`), so every demo
"5% discount" was a 500% discount and drove prices to the ≥ 0 floor. It surfaced only when
the price trace showed the step — the validator checked the dataset's own convention, not
the column's.

**Rule:** When a dataset field and the column it lands in use different units, convert in
the tier at the insert, next to a comment naming both units — and check any new percent
field against how the engine reads the column, not against the dataset type.

**Applies to:** `packages/database/src/datasets/tiers/*` — `pricingRule.amount`, and any
other fraction-valued column (`discountPercent`, `taxPercent`, rates).
