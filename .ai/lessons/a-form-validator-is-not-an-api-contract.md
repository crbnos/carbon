---
paths: []
triggers: []
promoted: null
---
# A form validator is not an API contract

**Context:** `production_createJobOperation` answered a bare 500 "Failed to insert job operation" to an API caller (2026-10-27).

**Problem:** Operations moved from routes kept the route's input and error handling. The form sent a fresh client-made `id` for each new row, so the create input required one and an API caller had to invent it; a reused id failed the insert. The route's toast-only `ctx.error("internal", "Failed to …", error)` (448 of them) then hid the database's reason, so a duplicate key or a reference to nothing read as our failure.

**Rule:** A create input leaves the new row's `id` optional when the table has a default (`mcp-create-inputs.test.ts` fails otherwise). A database refusal the caller can fix is reported as itself: `defineServiceFn` maps an `internal` error whose cause is one (`databaseRefusal`), so don't swallow the cause. A yes/no field is a real boolean that also parses the form's `"true"` / `"false"` (`booleanField`, `shared.models.ts`), so the API publishes `boolean`. A rich-text (JSON) column takes `optionalTiptapDoc` / `requiredTiptapDoc`, never `z.string()` or `z.unknown()`: a raw string is stored as a JSON scalar the editor cannot read. A JSON value a form posts as text takes `jsonInput(schema)`. Never `z.preprocess` / `z.coerce` / `z.any()` bare in an operation's input: the manifest publishes those as "anything".

**Applies to:** every `defineServiceFn` in `apps/erp/app/modules/*/*.server.ts`, and any validator reused as an operation's input.
