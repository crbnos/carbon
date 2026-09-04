# MCP: explicit `_operation` for ambiguous upsert tools

Branch: `fix/mcp-upsert-operation-flag`

## Problem

Carbon's `upsert*` service functions pick insert vs update by testing
`if ("createdBy" in payload)`. The web app is safe because the "new" route and the
"edit" route each hard-code their intent (`createdBy: userId` vs `updatedBy: userId`).

MCP has one tool per service function, so it cannot know the intent. Today
`enrichWithAuthContext` (`apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts:57`)
stamps `createdBy` onto every payload for any tool whose `injectAuth` contains it —
262 of 1431 tools. Consequence: **an edit issued through MCP always takes the insert
branch**, so it either duplicates or fails on the primary key instead of updating.

Rejected alternatives (and why):

- **Decide on `id` presence** — breaks entities whose id is a human-typed code.
  `partValidator` (`apps/erp/app/modules/items/items.models.ts:824`) requires `id` on
  create, so `items_upsertPart` would become a no-op update. Confirmed create call
  sites that pass both `createdBy` and an `id`:
  `apps/erp/app/routes/api+/sales-rfq.$rfqId.map-lines.ts:99`,
  `apps/erp/app/routes/api+/purchase-invoice.$invoiceId.map-lines.ts:94`,
  `apps/erp/app/routes/x+/part+/new.tsx:36`, `x+/tool+/new.tsx:35`,
  `x+/material+/new.tsx:35`, `x+/consumable+/new.tsx:35`, `x+/service+/new.tsx:35`,
  `x+/items+/methods+/operation.new.tsx:41`.
- **Decide on `createdAt` presence** — only works if the caller echoes back a whole
  row it read; a model editing one field won't.
- **A new marker column / field on the service payload** — would require touching all
  affected service signatures and stripping the field before every write.

## Approach

Add an MCP-only argument `_operation: "create" | "update"`, required, on the tools
that genuinely branch. The executor reads it, removes it from the payload, and stamps
`createdBy` or `updatedBy` accordingly. No service, validator, or table changes.

### Scope — which tools get the flag

Only tools whose service body literally contains `if ("createdBy" in …)`. Measured
today: **88 tools** (of the 191 `upsert*`-named tools, of the 262 `createdBy`-injecting
tools). Detection is done in the generator by inspecting the parsed function body, so
the set stays correct as services change — it is not a hand-maintained list.

Deliberately excluded:

- The 71 `insert|create|copy|generate|duplicate|add` tools — always create. Asking the
  model "create or update?" only introduces a wrong answer that could skip `createdBy`
  and hit a NOT NULL violation.
- The ~103 `upsert*` tools that decide some other way (Postgres `.upsert()`, `"id" in`,
  or always-insert). They still need `createdBy`; changing their injection could break
  writes that work today.

## Changes

### 1. `scripts/generate-mcp.ts`

- New helper `usesCreatedByDiscriminator(serviceContent, funcName)`: locate the
  function body (reuse `findMatchingBrace`) and test for `"createdBy" in`.
- New `ToolMetadata` field `operationArg?: true`, set when that helper is true **and**
  `injectAuth` includes `createdBy`.
- When `operationArg` is set, add to the emitted schema:
  ```
  _operation: {
    type: "string",
    enum: ["create", "update"],
    description: "Whether this call creates a new record or updates an existing one."
  }
  ```
  and add `"_operation"` to the schema's `required` array.
- Regenerate `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`
  (`npx tsx scripts/generate-mcp.ts`). Never hand-edit that file.

### 2. `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts`

- Immediately after `normalizedArgs` is derived, lift the flag out and drop it from the
  object that will be passed on:
  ```
  const operation = normalizedArgs?._operation as "create" | "update" | undefined;
  ```
  then build the working args without `_operation`. This must happen **before** the
  branches at lines ~164 and ~187, which hand the args object to the service as-is —
  a leftover `_operation` would reach Supabase as a nonexistent column.
- If the tool has `operationArg` and `operation` is missing or not one of the two
  values, return `{ success: false, error: "..." }` without calling the service.
- `enrichWithAuthContext(value, context, fields, operation)`:
  - `operation === "update"` → stamp `updatedBy` (and `companyId`), **never** `createdBy`.
  - `operation === "create"` or tool has no `operationArg` → today's behaviour exactly.
  - Keep the existing `!("createdBy" in enriched)` guard so a caller-supplied value wins.

### 3. Nested-payload note

`_operation` arrives at the top level of the tool arguments, while the payload may be
nested under a parameter name (line ~168). Lifting it out at the top, as above, covers
both the nested and the flat shapes.

## Verification

- `npx tsx scripts/generate-mcp.ts` → diff shows `_operation` on ~88 tools and on no
  others; `totalTools` unchanged at 1431.
- `pnpm exec turbo run typecheck --filter=erp` (package is named `erp`, not `@carbon/erp`).
- `pnpm exec biome check` on the touched files.
- Manual MCP calls against a running dev stack:
  - `sales_upsertCustomerStatus` with `_operation: "update"` + an existing id → row is
    updated, `createdBy` unchanged, `updatedBy` set.
  - `sales_upsertCustomerStatus` with `_operation: "create"` → new row as before.
  - `items_upsertPart` with `_operation: "create"` and a human-typed `id` → still creates.
  - A `..._insert*` tool → unchanged, no `_operation` in its schema.

## Out of scope

- Changing the `if ("createdBy" in …)` convention in the 88 services.
- An existence lookup as a cross-check on a wrong `_operation`. Worth revisiting if the
  model gets it wrong in practice; a wrong value fails loudly today (PK conflict or a
  zero-row update), which is already better than the silent misroute.
