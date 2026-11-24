---
paths: ["scripts/lib/input-docs.ts", "packages/api/src/service-fn.server.ts"]
triggers: [".default("]
promoted: null
---
# A published schema default is a promise the server has to keep

**Context:** API and MCP input schemas are generated from the form validators, whose `.default(0)` was written for a form that submits every field. The dispatcher applied none of them.

**Problem:** A caller reading `taxPercent: default 0` leaves the field out and expects 0. On a read typed from a validator's output that crashed (`state: {}` on a pivot); on an update, filling it would overwrite a stored value the caller never mentioned. And a default that looked safe to fill was not: list reads published `limit: default 100`, but the service pages only when it is handed a limit, so filling it would have cut every unpaged list read to 100 rows.

**Rule:** A default is filled or it is not published (`defaultsPolicy` / `publishDefaults`): always for a read, a create or an action, on create only for an upsert, never for an update. Before publishing or filling one, read what the service does when the field is absent, and compare with the column's own database default.

**Applies to:** `scripts/lib/service-metadata.ts`, `apps/erp/app/routes/api+/v1+/lib/dispatch.server.ts`, any validator default that reaches an API schema.
