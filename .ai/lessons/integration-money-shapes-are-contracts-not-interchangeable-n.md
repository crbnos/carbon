---
paths: ["packages/ee/src/ramp/**"]
triggers: ["fromMinorUnits", "currency_code", "entity_amount"]
promoted: null
---
# Integration money shapes are contracts, not interchangeable numbers

**Context:** Ramp returns signed `{ value, currency }` and `{ amount, currency_code }` values in minor units, while its deprecated transaction `amount` fallback is a major-unit decimal. Several inbound families also still expose unverified bare-number fields.

**Problem:** One generic converter treated every number as minor units, understating a `$123.45` fallback to `$1.23`; missing values became zero, unknown currency precision became two decimals, and unresolved foreign exchange rates became one. Those defaults turned malformed or incomplete provider payloads into apparently valid financial documents.

**Rule:** Normalize each provider money field through a helper tied to its verified wire shape. Reject missing, non-finite, fractional-minor, currency-mismatched, or unverified bare-number values per item. Currency precision and exchange rates are required accounting facts; never guess them or silently post foreign currency at par.

**Applies to:** Ramp charges, transfers, cashbacks, bills, bill payments, reimbursements, repayments, and future provider payloads with multiple monetary representations.
