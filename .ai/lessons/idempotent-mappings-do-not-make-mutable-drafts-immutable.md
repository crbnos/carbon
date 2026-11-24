---
paths: ["packages/ee/src/ramp/**"]
triggers: ["externalIntegrationMapping"]
promoted: null
---
# Idempotent mappings do not make mutable Drafts immutable

**Context:** Ramp retries find an existing external mapping before staging and posting a charge.

**Problem:** Treating every mapping as completed caused a corrected provider record to post the stale Carbon Draft left by an earlier failed attempt. The mapping proved identity, not finalization.

**Rule:** Branch retry behavior on the mapped entity's lifecycle state. Refresh a mutable Draft and its lines atomically under the same lock used for posting; only a finalized, observably Posted entity may bypass source normalization and be reconfirmed unchanged.

**Applies to:** Ramp charges, transfers, cashback, and any mapped inbound document whose provider data can change before local finalization.
