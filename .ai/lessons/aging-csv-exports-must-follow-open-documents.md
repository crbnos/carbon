---
paths: ["apps/erp/app/routes/x+/reports+/aging.server.ts", "apps/erp/app/routes/x+/reports+/a?-aging*"]
triggers: ["getArOpenByCustomer", "getApOpenBySupplier", "agingCsv"]
promoted: null
---
# Aging CSV exports must follow open documents

**Context:** Exporting AR/AP aging from a summary RPC and a separate open-document RPC.

**Problem:** A counterparty with offsetting open documents can have a zero net balance and disappear from the summary RPC while its documents remain open. Looking up names and building CSV rows only from summary parties silently drops those documents.

**Rule:** Union counterparty IDs from the summary, open-document, and unapplied-payment RPCs. Export one row per open document or payment with the counterparty repeated, including parties whose net summary is zero. Resolve CSV headings from the request locale. Include any RPC migration in the tracked change before relying on regenerated types.

**Applies to:** AR/AP aging CSV routes and report helpers.
