---
paths: []
triggers: ["chargeStatus"]
promoted: null
---
# Lifecycle transitions need a stored state invariant

**Context:** Charges use triggers to restrict Draft edits and the Draft→Posted→Voided transition sequence, while imports and test cleanup can intentionally bypass ordinary triggers.

**Problem:** Transition guards constrained how a row could change but did not guarantee that every stored status had its required audit shape. A status-only write could leave a Posted or Voided row without its actor and timestamp evidence.

**Rule:** Pair lifecycle transition guards with a validated database CHECK that defines every legal stored state. Fail migration preflight with row identities when existing data violates the invariant; never fabricate missing audit actors or timestamps.

**Applies to:** Charges and any auditable document lifecycle whose writers can bypass ordinary triggers or write status and audit fields independently.
