# Fix Carbon MCP quote-setup tool bugs

Reported by Anthan (via Brad) while using the Carbon MCP for quote setup. Nine
items; #1 is client-side (not fixable here). The rest are generator, executor,
classification, and service-behavior bugs. One PR.

Ground truth: `scripts/generate-mcp.ts` parses `{module}.service.ts` signatures
textually → `tool-metadata.json`; `api+/mcp+/lib/direct-executor.ts` runs tools
positionally and stamps auth via `enrichWithAuthContext`.

## Root causes (confirmed)

- **#2** `quoteLinePrices` shows `type:object` not `array`. `buildToolSchema`'s
  multi-param branch special-cases `startsWith("{")` → `parseInlineObjectType`,
  which swallows the trailing `[]`. `typeToJsonSchema` already handles `{...}[]`
  (array check precedes object check) — the branch just bypasses it.
- **#5** `upsertQuoteLine` drops `quantity` (+ every field after the first
  `errorMap`). The depth counters (`splitAtTopLevel`/`findTopLevelColon`/
  `splitObjectFields`) treat the `>` in a `=>` arrow as a generic close, driving
  depth negative so no further top-level commas split. Affects EVERY validator
  with an arrow (errorMap, refine) before later fields — many tools.
  (`externalNotes`/`internalNotes` are not in `quoteLineValidator` at all → out
  of scope; documented as a follow-up.)
- **#3** `createdBy` NOT NULL but never injected into array elements.
  `enrichWithAuthContext` returns arrays untouched (`Array.isArray → return`).
- **#9** `items_upsertService` param is opaque `{}`. Type is
  `applyStorageAndShelfLifeRefines(itemValidator.merge(z.object({...})))` — not a
  bare `z.object(`, so `parseValidatorFields` returns null → fallback `{}`.
- **#8** delete-and-reinsert classified WRITE (name-based `upsert*`→WRITE).
- **#7** `leadTime`/`discount`/`shipping` silently ignored: carry-over
  `existing?.X ?? p.X` (recalc route depends on this to preserve stored values).
- **#4** `quoteLine.quantity[]` not synced to the rewritten price rows.
- **#6** new break defaults to `priceSource:"system"` at raw unitPrice.

## Changes

### A. Generator (`scripts/generate-mcp.ts`)
1. Depth counters ignore `=>`: when `ch === ">"` and prev char is `=`, don't
   decrement. Apply in `splitAtTopLevel`, `findTopLevelColon`, `splitObjectFields`.
   (Fixes #5 broadly.)
2. `buildToolSchema` multi-param branch: replace the `startsWith("{")` special
   case with `typeToJsonSchema(param.typeStr)` so `{...}[]` → array. Do the same
   in the single-param inline branch, but when the resolved schema is an array
   wrap it under `param.name` (can't flatten an array into top-level props).
   (Fixes #2.)
3. Add `CLASSIFICATION_OVERRIDES: Record<string,"READ"|"WRITE"|"DESTRUCTIVE">`
   (mirrors `INJECT_AUTH_OVERRIDES`); `sales_upsertQuoteLinePrices → DESTRUCTIVE`.
   Also add `INJECT_AUTH_OVERRIDES['sales_upsertQuoteLinePrices'] =
   ['companyId','createdBy']` so DESTRUCTIVE classification doesn't strip the
   per-row createdBy injection. (Fixes #8.)
4. Add `SCHEMA_OVERRIDES: Record<string, object>` for tools whose param type the
   parser can't resolve; author `items_upsertService` with the real fields +
   `_operation`, and a description note: `id` is the Service ID (used as
   readableId); never pass `readableIdWithRevision` (generated column). (Fixes #9.)
5. `DESCRIPTION_OVERRIDES` for the two pricing tools describing destructive-by-
   omission + carry-over + explicit-set semantics.

### B. Executor (`api+/mcp+/lib/direct-executor.ts`)
- `enrichWithAuthContext`: when `value` is an array, map each object element,
  injecting ONLY `companyId` + `createdBy` (never `updatedBy` — avoids spreading
  a column the element table may not have). Non-object elements pass through.
  (Fixes #3.)

### C. Service (`sales.service.ts` `rewriteQuoteLinePrices` + input type)
- Make `leadTime`/`discountPercent`/`shippingCost`/`quantity`... keep required
  except make `leadTime`/`discountPercent`/`shippingCost` optional on
  `QuoteLinePriceInput`; change carry-over to `p.X ?? existing?.X ?? default`
  (explicit wins, omitted → carry). (#7)
- `priceSource: p.priceSource ?? existing?.priceSource ?? "manual"` (was
  `"system"`) — a hand-set API price with no source is manual. Recalc still sets
  `"system"` explicitly. (#6)
- After an EXPLICIT `quoteLinePrices` rewrite (not the precision rebuild, not the
  empty no-op), sync `quoteLine.quantity` to the sorted distinct quantities of
  the inserted rows, inside the same trx. (#4)

### D. Caller (`x+/quote+/$quoteId.$lineId.recalculate-price.tsx`)
- Stop passing `discountPercent:0, leadTime:0`; omit them so carry-over preserves
  the stored values (now that explicit values win). Quantities unchanged → #4
  sync is a no-op here.

### E. Regenerate + verify
- `npx tsx scripts/generate-mcp.ts`; eyeball the 3 tools; sanity-check that the
  `=>` fix only ADDED fields (no tool lost properties); totalTools unchanged.

### F. Tests + docs
- `sales.utils`/service test: explicit leadTime/discount wins; omitted carries;
  quantity sync; priceSource default manual. Generator unit checks for the `=>`
  and `[]` cases if a harness exists (else rely on metadata diff).
- Sync `quote-discount-system.md`, sales `AGENTS.md`, `mcp-tools-reference.md`.

## Out of scope (documented)
- #1 MCP eviction (client/transport).
- #5 notes fields (not in the validator; separate rich-text write path).

## Verify
- `pnpm exec turbo run typecheck --filter=erp`
- `cd apps/erp && pnpm exec vitest run app/modules/sales`
- generated `tool-metadata.json` diff review
