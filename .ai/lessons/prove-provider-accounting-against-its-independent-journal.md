---
paths: []
triggers: []
promoted: null
---
# Prove provider accounting against its independent journal

**Context:** The live Rillet E2E run accepted invoice payloads while ignoring their FX override and crediting deferred revenue.

**Problem:** Request shape and HTTP success did not prove economic parity. AR_ONLY used provider FX; the supported REVENUE_RECOGNITION_ONLY scope accepted fixed document-to-base rates and same-day recognition.

**Rule:** Verify returned account effects in the provider's independent GL, including recognition and voids. Treat Carbon's rate as document units per base unit, invert it for Rillet, and align recognition and FX dates with Carbon's posting date. Check voided mappings before create-idempotency shortcuts and retain durable deletion markers.

**Applies to:** Rillet invoice/bill/payment adapters, native-void reconciliation, and future provider acceptance tests.
