# Task: Map Extracted Lines for Purchase Invoice

## Plan and Progress
- [ ] Create API endpoint `purchase-invoice.$invoiceId.map-lines.ts` (loader + action) with Smart Map logic. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Create `MapExtractedInvoiceLinesModal.tsx` UI component for mapping unmapped invoice lines. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Integrate warning banner + modal into `PurchaseInvoiceExplorer.tsx`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [ ] Add API path helper for purchase invoice in `path.ts`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Review
- [ ] Verify no duplicate item creation (Smart Map)
- [ ] Ensure auto-fill dropdown works when item exists

## Future Improvements
- [ ] **AI Extraction Entity Matching**: Currently, when auto-filling forms from PDF extractions, the matching logic uses `ilike` substring search (e.g., `name.ilike.%extracted_name%`). This is a one-way match and can lead to duplicate records. 
  - *Example*: If the DB has "Autobus SE Technologi" and the AI extracts "Autobus SE", the match works because the extracted name is shorter and contained within the DB name. However, if the AI extracts "Autobus SE Technologi" and the DB only has "Autobus SE", the match fails and the user might inadvertently create a duplicate.
  - *Proposed Solution*: Implement a more robust matching strategy, such as fuzzy matching (e.g., trigram similarity `pg_trgm`) or pre-normalizing the extracted names using an AI prompt before matching against the database.
