# Price List: make all-customers overrides visible, linkable and deliberate

Branch: `fix/price-list-all-customers-scope` (from `origin/main`).

## Context

A quote for Airlogix showed a −$3,320 "All Override" step that the user could not find or remove.
It is a `customerItemPriceOverride` row with no `customerId` and no `customerTypeId` — an
**all-customers** override ($6,679 on TTJ-300, copied from Q000004's manual price, note
"Source: Q000004 … set 2026-10-23"). The schema supports this scope on purpose
(`customerItemPriceOverride_all_item_uq`, migration `20260414120001`), and the pricing engine
applies it (`resolvePrice`, `sales.service.ts` ~2346; `resolvePriceList` ~2650), but:

1. **No screen lists it.** `resolvePriceList` (`sales.service.ts` ~2486) lists only items with an
   override at the chosen scope; with no scope, `getBaseCatalog` ignores overrides. The
   `ScopePicker` offers only customer types and customers.
2. **No form can create or show it.** `PriceOverrideForm` scope is `"customer" | "customerType"`.
3. **The write is silent.** `upsertCustomerItemPriceOverride` (MCP tool + HTTP + both form
   routes) treats "no customerId and no customerTypeId" as all customers, so one omitted field
   turned a one-off quote price into everyone's list price. The form route can do the same
   (customer scope with an empty Customer field).
4. **The trace can't link to it.** Override steps carry no id; only rule steps link.

Decisions (agreed): explicit `allCustomers` flag checked in the building block; a customer or
type scope also lists the overrides it inherits, tagged with the existing badges.

## Changes

### 1. Guard the write — `apps/erp/app/modules/sales/sales.service.ts`
- `upsertCustomerItemPriceOverride(db, companyId, userId, data)`: add `allCustomers?: boolean`.
  - neither id and `allCustomers !== true` → `{ error: { message: "Choose a customer, a customer type, or All Customers" } }`
  - `allCustomers === true` with either id → error ("All Customers cannot also name a customer or type").
- `sales.server.ts` `upsertCustomerItemPriceOverride` input: add
  `allCustomers: z.boolean().describe("Set true to apply the price to every customer. Required when neither customerId nor customerTypeId is sent.").optional()`.
- `sales.models.ts` `priceOverrideValidator`: add `allCustomers: zfd.checkbox()`; refine
  "exactly one scope" (customer, type, or all) with the field error on `customerId`.
- Both routes (`price-list.new.tsx`, `price-list.$overrideId.tsx`) pass `allCustomers` through.
- Regenerate MCP metadata (`pnpm run generate:mcp`) — the tool schema gains one field.

### 2. Form — `ui/Pricing/PriceOverrideForm.tsx`
- `ScopeType` gains `"all"`; third `ChoiceCardGroup` option **All Customers** ("Override the
  price for every customer", `LuGlobe`). Initial scope: `all` when editing a row with neither id
  (today it falls into "customer" with an empty field). `all` renders `Hidden` empty ids +
  `Hidden name="allCustomers" value="on"`.
- `price-list.new.tsx` loader: `?scope=all` seeds `initialScope: "all"`.

### 3. List — `resolvePriceList` + loader + picker
- `resolvePriceList` args gain `allCustomers?: boolean`.
  - **Item set:** union of item ids with an active override at the requested scope AND, for a
    customer, its type's and the all-customers overrides; for a type, the all-customers ones;
    for `allCustomers`, the all-customers ones only. (Resolve the customer's type before the
    scope query — it is already read further down; move it up, one read.)
  - Per-row resolution is unchanged (override ?? type ?? all), so `overrideSource` and
    `overrideId` already point at the override that applies; the table's existing badge
    (`PriceOverridesTable.tsx` line ~71) and Edit/Delete use them.
- `resolvePriceList` service fn (`sales.server.ts` ~6934): add `allCustomers` to input.
- `utils/list-registry/sales.server.ts` `priceListList`: `scope=all` param → `resolvePriceList({ allCustomers: true })`.
- `price-list.tsx` `hasScope` includes `scope=all`.
- `ScopePicker.tsx`: `helper` gains `"All"`; a first group with one item **All Customers**
  (value `"all"`, icon `LuGlobe`), always present. `PriceOverridesTable.handleScopeChange`
  maps it to `scope=all` (clearing `customerId`/`customerTypeId`); `scopeId` reads it back.
  Options are added in the loader so the empty state (`PriceListScopeEmpty`) gets it too.
- Duplicate modal: out of scope (it requires a target scope; all-customers as a source/target is
  a later change).

### 4. Trace link — `types.ts`, `resolvePrice`, `resolvePriceList`, `PriceTraceModal.tsx`
- `PriceTraceStep` gains `overrideId?: string`.
- Set it on the Override / Type Override / All Override steps in both `resolvePrice` (~2307–2368)
  and `resolvePriceList` (~2662–2696).
- `PriceTraceModal` (~167): link `step.overrideId` to `path.to.priceOverride(id)` the same way
  `ruleId` links to `path.to.pricingRule`. Traces stored before this change have no id and stay
  plain text.

### 5. Docs / rules
- `apps/erp/app/modules/sales/AGENTS.md`: the three override scopes, the `allCustomers` flag,
  and that a scoped list shows inherited overrides.
- Docs page for price lists if one exists under `docs/content/docs/reference/` (check; ground in code).
- Lingui: `pnpm lingui:extract` for the new strings.

## Tests (red → green)
- `upsertCustomerItemPriceOverride` scope guard: no scope + no flag refused; flag + id refused;
  flag alone writes a row with both ids null. Live-DB test beside the existing sales ones
  (`apps/erp/test/database/`), or a pure helper `priceOverrideScopeError(data)` in
  `sales.utils.ts` tested in `sales.utils.test.ts` if the DB fixtures don't cover sales.
- `priceOverrideValidator` refines in `sales.models.test.ts`: exactly one scope.
- Item-set union: pure helper (`priceListItemIds(rows, scope)`) tested in `sales.utils.test.ts`.

## Verification
- `pnpm exec turbo run typecheck --filter=erp`, `pnpm run lint`, `pnpm --filter erp test`
  (scoped to the sales tests), `pnpm run generate:mcp` diff shows only the new field.
- Browser (`/auth` + `/test`, local stack): seed an all-customers override, then
  - Price List → scope picker shows **All Customers**; selecting it lists the row with an
    All Override badge; Edit opens the form on **All Customers**; Delete removes it.
  - Choose a customer → the same item appears tagged All Override.
  - Quote line → Pricing Trace → the All Override description links to the override.
  - Override form → All Customers → saves; Specific Customer with an empty Customer → field error.
- MCP: `sales_upsertCustomerItemPriceOverride` with only `itemId` → refused with the message;
  with `allCustomers: true` → succeeds.

## Separate from this branch (production data)
The Airlogix/TTJ-300 override still applies in the tenant. Once this ships it is reachable via
All Customers; until then it can be deleted through `sales_deleteCustomerItemPriceOverride`
once its id is known (I'll ask before any destructive call).
