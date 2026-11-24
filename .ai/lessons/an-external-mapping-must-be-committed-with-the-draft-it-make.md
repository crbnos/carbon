---
paths: []
triggers: []
promoted: null
---
# An external mapping must be committed with the Draft it makes idempotent

**Context:** Ramp reimbursement sync created a supplier interaction, purchase-invoice Draft, delivery, and lines through separate Supabase requests, then wrote the external mapping last.

**Problem:** A crash before the mapping left a complete but untracked Draft, so the next provider retry could create a duplicate. A transaction alone also leaves same-key concurrent workers racing until the final unique mapping write.

**Rule:** Create the local Draft structure and its external mapping in one Kysely transaction. Serialize the tenant-scoped external key before the initial mapping read (for example with a transaction advisory lock), and provide a narrowly constrained legacy-adoption path for Drafts created by the old writer. Prove create/resume, two-connection convergence, and mid-write rollback against real Postgres.

**Applies to:** inbound provider document/payment staging and any retryable workflow whose idempotency anchor is `externalIntegrationMapping`.
