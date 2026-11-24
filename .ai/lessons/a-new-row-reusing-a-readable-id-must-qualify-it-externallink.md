---
paths: ["apps/erp/app/modules/production/production.service.ts", "apps/erp/app/modules/sales/sales.service.ts"]
triggers: ["externalLink", "quoteToQuote", "deleteQuote"]
promoted: null
---
# A new row reusing a readable id must qualify it — `externalLink` is UNIQUE per document

**Context:** "Create Quote Revision" failed with a generic "Failed to duplicate quote". The real error was only in the edge-runtime log: `duplicate key value violates unique constraint "externalLink_documentId_documentType_unique"`.

**Problem:** `externalLink` is `UNIQUE (documentId, documentType, companyId)` (`20250711000000_customer-portal-links.sql`). A quote revision deliberately keeps the same readable `quoteId` as its source, and `get-method`'s `quoteToQuote` branch inserted a share-link row keyed on that bare id — so every revision collided with the original's link and rolled back the whole copy transaction. Worse, `deleteQuote` deletes only the `quote` row (the FK points quote→link, so nothing cascades), leaving orphan link rows that re-collide when the same revision number is issued again.

**Rule:** Any new row that reuses an existing readable id must qualify it (`Q000001-1`), and any insert into a table whose unique key can be orphaned by a delete needs `onConflict(...).doUpdateSet(...)` rather than a bare insert. When a user-facing action reports a generic failure, read the edge-runtime container log before theorising — the route's flash message hides the Postgres error code.

**Applies to:** `getMethod` in `apps/erp/app/modules/production/production.service.ts` (`quoteToQuote`), `apps/erp/app/modules/sales/sales.service.ts` (`deleteQuote`), any insert into `externalLink`.
