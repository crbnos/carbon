---
paths: []
triggers: ["TS2589", "ALTER TABLE \"salesInvoiceLine\"", "ALTER TABLE \"salesOrderLine\"", "ALTER TABLE \"jobMaterial\"", "_fkey("]
promoted: null
---
# A new FK on a busy table breaks bare PostgREST embeds of it (TS2589)

**Context:** The contracts migration (`20261006221301_contracts.sql`) gave `salesInvoiceLine` four new FKs (`customerContractId`, `customerContractLineId`, `customerContractInvoiceLineId`, `projectId`).

**Problem:** After `generate:types`, the ERP typecheck failed with TS2589 ("type instantiation is excessively deep") in four files that the change did not touch. Each did a bare embed such as `.select("salesInvoice(id, invoiceId)")` from `salesInvoiceLine`. More relationships on the table make the inference of a bare embed too deep. A `@ts-ignore` would hide it, but the next new FK moves the error to another file.

**Rule:** When you add a FK to a table that other code embeds from, name the FK in every embed of its parent: `salesInvoice!salesInvoiceLine_invoiceId_fkey(...)`. Run the scoped `erp` typecheck after `generate:types`, before you commit the migration. Fix the cause at the embed by naming the FK (fix commit `5b26a095dd`). Use `@ts-ignore` (the TS2589 lesson above) only for an embed that already names its FK.

**Applies to:** any migration that adds a FK column to `salesInvoiceLine`, `salesOrderLine`, `jobMaterial` or another widely embedded table; the PostgREST selects in `apps/erp` that embed from it.
