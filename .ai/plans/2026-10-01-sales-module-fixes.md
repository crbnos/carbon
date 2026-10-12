# Sales module fixes: implementation plan

**Spec / source:** `.ai/specs/2026-10-01-sales-module-fixes.md`
**Branch:** `fix/sales-module` (worktree `/Users/aashu/work/carbon/carbon-fix-sales-module`)

All commands run from the worktree root unless stated. **Never commit**: the user commits by hand. Every new user-facing string goes through Lingui (`<Trans>` or `` t`…` `` from `useLingui()`). Zod validator messages in `*.models.ts` are plain English strings across the codebase (e.g. `sales.models.ts:86`); follow that idiom.

## Progress
- [x] Task 1: Reject repeated quantity breaks in the quote line validator
- [x] Task 2: Dedupe quantity breaks when reading (loader + pricing grid)
- [x] Task 3: Add the shared `DisabledReason` component and `getDisabledReason` helper
- [x] Task 4: Fix the label column in the Costing and Pricing tables
- [x] Task 5: Public quote page: "Remove this item", Removed badge, Accept gate
- [x] Task 6: Server guards against empty quote acceptance
- [ ] Task 7: Rework the sales order job row
- [ ] Task 8: Disabled reasons on the quote header and the Convert drawer
- [ ] Task 9: Disabled reasons on the sales order header
- [ ] Task 10: Disabled reasons on the RFQ and return order headers
- [ ] Task 11: Extract and translate new strings
- [ ] Task 12: Full gates + browser verification

## Dependencies
- Tasks 1, 2, 3, 4, 6 and 7 are independent of each other.
- Task 5 needs Task 3 (uses `DisabledReason`).
- Tasks 8, 9 and 10 need Task 3; they are independent of each other.
- Task 11 needs Tasks 1–10. Task 12 needs everything.

---

## Task 1: Reject repeated quantity breaks in the quote line validator

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts`: the `quantity` field of `quoteLineValidator` (currently lines 493–495)
- Modify: `apps/erp/app/modules/sales/sales.models.test.ts`: add a `describe("quoteLineValidator quantity breaks")` block
- Copy from (precedent): the existing `vi.mock("@lingui/core/macro")` + dynamic `await import("./sales.models")` setup at the top of `sales.models.test.ts`

**Steps:**
1. Replace the `quantity` field with:
   ```ts
   quantity: z
     .array(
       zfd.numeric(z.number().min(0.00001, { message: "Quantity is required" }))
     )
     .refine((quantities) => new Set(quantities).size === quantities.length, {
       message: "Each quantity must be different"
     }),
   ```
2. In the test file, change the import line to `const { quoteValidator, quoteLineValidator } = await import("./sales.models");`. Add two tests that call `quoteLineValidator.shape.quantity.safeParse(...)`:
   - `[10, 10, 25]` → `success === false`, and `error.issues[0].message === "Each quantity must be different"`.
   - `[10, 20, 25]` → `success === true`.
   - If `quoteLineValidator` is not a plain `z.object` (no `.shape`), STOP and report; do not improvise.
3. Confirm that `ArrayNumeric` (`packages/form/src/components/ArrayNumeric.tsx:58,104`) shows the array-level error. `useFieldArray` returns `error` for the field name. This is checked in the browser in Task 12.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/sales/sales.models.test.ts
# Expected: all tests pass, including the 2 new quantity-break tests
```

**Out of scope:** the sales order line validator, CSV import code, database constraints.

---

## Task 2: Dedupe quantity breaks when reading (loader + pricing grid)

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/x+/quote+/$quoteId.$lineId.details.tsx`: loader return, lines ~164–166
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx`: line 110

**Steps:**
1. Loader: change `[...line.data.quantity].sort((a, b) => a - b)` to `[...new Set(line.data.quantity)].sort((a, b) => a - b)`. Extend the comment above it by one line: `// Distinct: a line saved with a repeated break must not render twice (one price row per quantity).`
2. Pricing grid line 110: change to `const quantities = [...new Set(line.quantity ?? [1])].sort((a, b) => a - b);`.
3. Do not touch any write path.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks succeed, 0 errors
```

**Out of scope:** `onRecalculate`, `rewriteQuoteLinePrices`, the new-line route.

---

## Task 3: Add the shared `DisabledReason` component and `getDisabledReason` helper

**Depends on:** none
**Files:**
- Create: `packages/react/src/DisabledReason.tsx`
- Modify: `packages/react/src/index.tsx`: import and export `DisabledReason` and `getDisabledReason`, next to the `TruncatedTooltipText` import (line ~364) and export (line ~661)
- Copy from (precedent): `apps/erp/app/modules/items/ui/ChangeNotice/ItemChangeNoticeLock.tsx:41-80`

**Steps:**
1. Create the file with the AGPL header used by every file in `packages/react/src` (copy the 3 comment lines from `TruncatedTooltipText.tsx`), then:
   ```tsx
   import type { ReactNode } from "react";
   import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
   import { cn } from "./utils/cn";

   /** First reason whose condition holds, or undefined when nothing blocks. */
   function getDisabledReason(
     checks: ReadonlyArray<readonly [blocked: boolean, reason: string]>
   ): string | undefined {
     return checks.find(([blocked]) => blocked)?.[1];
   }

   type DisabledReasonProps = {
     reason?: ReactNode;
     className?: string;
     children: ReactNode;
   };

   // A disabled <button> fires no pointer events, so the focusable span carries
   // the tooltip and gives keyboard users a tab stop to read it.
   function DisabledReason({ reason, className, children }: DisabledReasonProps) {
     if (!reason) return <>{children}</>;
     return (
       <Tooltip>
         <TooltipTrigger asChild>
           <span tabIndex={0} className={cn("inline-flex", className)}>
             {children}
           </span>
         </TooltipTrigger>
         <TooltipContent>{reason}</TooltipContent>
       </Tooltip>
     );
   }

   export { DisabledReason, getDisabledReason };
   ```
2. Add both names to the barrel import and export lists, in alphabetical position.

**Verify:**
```bash
pnpm --filter @carbon/react typecheck && pnpm exec biome check packages/react/src/DisabledReason.tsx packages/react/src/index.tsx
# Expected: typecheck exits 0; biome reports no errors
```

**Out of scope:** changing `Button`'s props; replacing existing local wrappers (`ItemChangeNoticeLock`, `AssemblyBomTree`).

---

## Task 4: Fix the label column in the Costing and Pricing tables

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Quotes/CostRowLabel.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteLineCosting.tsx`: header `Th` (line 88) and every label `Td` (lines 96, 133, 173, 203, 233, 263, 295, 322, 354, 382, 414, 443, 471, 500, 533)
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx`: header `Th` (line 888) and every label `Td` (lines 896, 936, 973, 1019, 1045, 1087, 1114, 1140, 1158, 1194, 1222, 1260, 1350, 1388, 1408, 1436, 1464, 1482)
- Copy from (precedent): `packages/react/src/TruncatedTooltipText.tsx` (truncation + tooltip); flex-row rules from `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderSummary.tsx:409-413`

**Steps:**
1. Create `CostRowLabel.tsx` (with the AGPL header):
   ```tsx
   import { cn, TruncatedTooltipText } from "@carbon/react";
   import type { ReactNode } from "react";

   type CostRowLabelProps = {
     label: ReactNode;
     /** Type marker shown before the label (icon or Enumerable badge). */
     icon?: ReactNode;
     /** Inline help (e.g. an info tooltip) right after the label. */
     info?: ReactNode;
     /** Trailing control pinned to the right (e.g. Predict lead time). */
     action?: ReactNode;
     className?: string;
   };

   export function CostRowLabel({ label, icon, info, action, className }: CostRowLabelProps) {
     return (
       <div className={cn("flex w-full min-w-0 items-center gap-2", className)}>
         {icon && <span className="flex shrink-0 items-center">{icon}</span>}
         <TruncatedTooltipText tooltip={label} className="min-w-0 truncate">
           {label}
         </TruncatedTooltipText>
         {info && <span className="flex shrink-0 items-center">{info}</span>}
         {action && <span className="ml-auto flex shrink-0 items-center">{action}</span>}
       </div>
     );
   }
   ```
   If `cn` or `TruncatedTooltipText` is not exported from `@carbon/react` (check `packages/react/src/index.tsx`), STOP and report.
2. Sticky, stable label column. Define a module-level constant in each table file:
   `const labelCellClass = "sticky left-0 z-[1] bg-card min-w-[200px] w-[260px] max-w-[260px] border-r border-border";`
   - Header: replace `<Th className="w-[300px]" />` with `<Th className={labelCellClass} />`.
   - Every label `Td`: replace `border-r border-border` with `{labelCellClass}` via `cn(labelCellClass, <existing extra classes such as "pl-10" / "pl-14" / "pl-8" / "group-hover:bg-muted/50">)`. Keep the indent classes so the hierarchy still reads.
3. Replace each label cell's inner `HStack justify-between` with `CostRowLabel`:
   - **Total rows (Costing):** `icon={<Enumerable value="Material" />}` (or Direct / Indirect / Outside, as the row has today) and `label={<Trans>Total Material Cost</Trans>}`.
   - **Detail rows:** move the existing `<MethodItemTypeIcon type=… />` / `<TimeTypeIcon type=… />` / `<LuClock />` into `icon`, rendered as a muted icon with no `Badge` wrapper (`<span className="text-muted-foreground">…</span>`).
   - **Part Cost:** keep its `LuInfo` tooltip, passed as `info`.
   - **Pricing "Lead Time":** move the Predict `IconButton` into `action`.
   - **Pricing "Markup Percent":** pass its `LuInfo` tooltip as `info`.
   - **"Markup by Category" toggle `Button` (Pricing ~1019–1035):** keep the Button, but give it `className="-ml-3 max-w-full"` and wrap its text in `<span className="truncate">`.
   - **"Total Estimated Cost" (Costing ~500):** `<CostRowLabel label={<Trans>Total Estimated Cost</Trans>} className="font-medium" />`.
   - Wrap every label string touched here in `<Trans>`. Today they are bare English, e.g. "Lead Time" at `QuoteLinePricing.tsx:898`.
4. Remove now-unused imports (`Badge`, `HStack`) only if nothing else in the file uses them.
5. If the `Table` wrapper (`packages/react/src/Table.tsx:10-34`) does not scroll horizontally (sticky needs the scroll container), STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/sales/ui/Quotes/
# Expected: 0 type errors; biome no errors
```
Visual check happens in Task 12.

**Out of scope:** the value cells, the cost maths, the Show Details switch.

---

## Task 5: Public quote page: "Remove this item", Removed badge, Accept gate

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/share+/quote.$id.tsx`: Remove button (~976–995), collapsed line header (~476–500), Accept button (~1350–1358), `@carbon/react` import list (lines 9–42)

**Steps:**
1. **Remove button:** change `<Trans>Remove</Trans>` to `<Trans>Remove this item</Trans>`. Leave the behaviour unchanged.
2. **Removed badge:** in `LineItems`, right after `<Heading className="min-w-0">{line.itemReadableId}</Heading>`, render:
   ```tsx
   {selectedLines[line.id!]?.quantity === 0 &&
     (pricingByLine[line.id!]?.length ?? 0) > 0 &&
     !["Ordered", "Partial", "Expired", "Cancelled"].includes(quote.status) && (
       <Badge variant="secondary" className="shrink-0">
         <Trans>Removed</Trans>
       </Badge>
     )}
   ```
   Add `Badge` to the `@carbon/react` import if it is missing. If the Heading's parent flex row places the badge badly (e.g. after the price), put the Heading and Badge in `<div className="flex min-w-0 items-center gap-2">`.
3. **Accept gate** in the component that renders the Accept button (it has `selectedLines` and `total` in scope near line 1173):
   ```tsx
   const hasSelectedItem = Object.values(selectedLines).some((l) => l.quantity > 0);
   ```
   Then wrap the Accept `Button`:
   ```tsx
   <DisabledReason
     className="w-full"
     reason={hasSelectedItem ? undefined : t`Select at least one item to accept the quote`}
   >
     <Button … isDisabled={!hasSelectedItem} className="w-full mt-8 text-lg">
   ```
   Move `mt-8` onto the `DisabledReason` className (`"w-full mt-8"`) so spacing doesn't change. Import `DisabledReason` from `@carbon/react`. Use `t` from `useLingui()`, which is already imported at line 44; destructure it in that component if it isn't already.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check 'apps/erp/app/routes/share+/quote.$id.tsx'
# Expected: 0 errors
```

**Out of scope:** totals maths, the confirm modal, the reject flow.

---

## Task 6: Server guards against empty quote acceptance

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/api+/sales.digital-quote.$id.tsx`: after `const selectedLines = parseResult.data;` (~line 93)
- Modify: `packages/database/supabase/functions/convert/index.ts`: right after the `selectedQuoteLines` filter (ends ~line 611)

**Steps:**
1. In the route, insert:
   ```ts
   if (!Object.values(selectedLines).some((line) => (line.quantity ?? 0) > 0)) {
     return {
       success: false,
       message: "Select at least one item to accept the quote."
     };
   }
   ```
2. In the edge function, after `selectedQuoteLines` is defined, insert:
   ```ts
   if (selectedQuoteLines.length === 0) {
     throw new Error("No quote lines selected to convert");
   }
   ```
   This runs inside the `trx` transaction, so the sequence draw above it rolls back. If the code at that point is not inside a transaction callback, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check 'apps/erp/app/routes/api+/sales.digital-quote.$id.tsx' packages/database/supabase/functions/convert/index.ts
# Expected: 0 errors
```

**Out of scope:** sales-rule evaluation, file upload handling, other `convert` cases.

---

## Task 7: Rework the sales order job row

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderLineJobs.tsx`: `SalesOrderJobItem` (lines 288–387)
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderSummary.tsx`: remove the `@ts-expect-error TS2739` at line 692 *only if* typecheck passes without it
- Copy from (precedent): flex-row rules in `SalesOrderSummary.tsx:409-413`; ID link styling from `apps/erp/app/components/Hyperlink.tsx:23-28` (`text-foreground font-medium`)

**Steps:**
1. Replace the `Hyperlink` wrapper with a plain React Router `Link`:
   `import { Link } from "react-router";` (merge into the existing `react-router` import),
   `<Link to={path.to.job(job.id!)} prefetch="intent" className="text-sm font-medium text-foreground whitespace-nowrap hover:underline">{job.jobId}</Link>`.
   Remove the `Hyperlink` import if nothing else in the file uses it.
2. Restructure the top row (keep every existing prop, condition and handler):
   ```tsx
   <div className="@container w-full">
     <div className="flex w-full flex-col gap-3 @xl:flex-row @xl:items-center">
       {/* identity */}
       <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
         <Link …>{job.jobId}</Link>
         <JobStatus … /> {/* + Due Today / Overdue exactly as today */}
       </div>
       {/* facts + actions */}
       <div className="flex shrink-0 items-center gap-6">
         <Assignee … />
         <div className="w-20">Complete block (unchanged markup) + "tabular-nums" on the <p></div>
         <div className="w-20">Shipped block (unchanged markup) + "tabular-nums" on the <p></div>
         <div className="flex items-center gap-1">Release Button + chevron IconButton (unchanged)</div>
       </div>
     </div>
   </div>
   ```
   Wrap the "Complete", "Shipped" and "Release" labels in `<Trans>`. Change the chevron's `aria-label` to `` disclosure.isOpen ? t`Collapse` : t`Expand` ``, with `t` from `useLingui()`.
3. Keep `{disclosure.isOpen && <JobDetails …/>}` and the release modal below the row, unchanged.
4. If Tailwind container queries (`@container` / `@xl:`) don't compile in apps/erp (check `apps/erp/app/components/Gantt/Gantt.tsx` for existing use), STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/sales/ui/SalesOrder/
# Expected: 0 errors
```

**Out of scope:** `JobDetails`, the `Hyperlink` component, the jobs tooltip list in `SalesOrderSummary.tsx:495-552`.

---

## Task 8: Disabled reasons on the quote header and the Convert drawer

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteHeader.tsx`: Finalize (~245), Won (~260), Lost (~283), Cancel (~311)
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx`: Next button (~390), condition `isNextButtonDisabled` (~329)
- Copy from (precedent): `apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteToOrderDrawer.tsx:137-155`

**Steps:**
1. Import `DisabledReason, getDisabledReason` from `@carbon/react`. `t` already comes from `useLingui()` in QuoteHeader.
2. Compute the reasons before the JSX. Use `status = routeData?.quote?.status` and `canUpdate = permissions.can("update", "sales")`:
   ```ts
   const finalizeReason = getDisabledReason([
     [status !== "Draft", t`Only draft quotes can be finalized`],
     [!eligibleLines?.length, t`Add at least one line that can be quoted`],
     [!canUpdate, t`You don't have permission to update quotes`]
   ]);
   const wonReason = getDisabledReason([
     [status !== "Sent", t`Only sent quotes can be marked as won`],
     [!canUpdate, t`You don't have permission to update quotes`]
   ]);
   const lostReason = getDisabledReason([
     [status !== "Sent", t`Only sent quotes can be marked as lost`],
     [!canUpdate, t`You don't have permission to update quotes`]
   ]);
   const cancelReason = getDisabledReason([
     [!canUpdate, t`You don't have permission to update quotes`]
   ]);
   ```
3. Wrap each `Button` in `<DisabledReason reason={xReason}>…</DisabledReason>`. For Lost and Cancel, wrap the `Button` *inside* the `statusFetcher.Form`. Keep each `isDisabled` expression exactly as it is, including the fetcher-busy terms, so behaviour doesn't change.
4. Drawer: wrap the Next button with `<DisabledReason reason={isNextButtonDisabled ? t`Select at least one line to convert` : undefined}>`.
5. If any current `isDisabled` expression differs from what step 2 assumes, STOP and report the difference.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/sales/ui/Quotes/QuoteHeader.tsx apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx
# Expected: 0 errors
```

**Out of scope:** ⋯ menu items, Share/Preview, the modals' submit buttons.

---

## Task 9: Disabled reasons on the sales order header

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx`: Confirm (~413), Cancel (~432), Ship (~526), Invoice (~595)

**Steps:**
1. Import `DisabledReason, getDisabledReason` from `@carbon/react`. Make sure `t` is available from `useLingui()`; add it if not.
2. Reasons:
   ```ts
   const confirmReason = getDisabledReason([
     [!["Draft", "Needs Approval"].includes(status), t`Only draft orders can be confirmed`],
     [lines.length === 0, t`Add at least one line before confirming`],
     [!canUpdate, t`You don't have permission to update sales orders`]
   ]);
   const cancelReason = getDisabledReason([
     [["Cancelled", "Closed", "Completed", "Invoiced"].includes(status), t`This order can no longer be cancelled`],
     [!canUpdate, t`You don't have permission to update sales orders`]
   ]);
   const shipReason = getDisabledReason([
     [!["To Ship", "To Ship and Invoice"].includes(status), t`Confirm the order before shipping`]
   ]);
   const invoiceReason = getDisabledReason([
     [!["To Invoice", "To Ship and Invoice"].includes(status), t`Confirm the order before invoicing`]
   ]);
   ```
   Use the local variable names the file already has for status, lines and permissions; read the surrounding code first.
3. Wrap each of the four Buttons in `DisabledReason`. Leave the `isDisabled` expressions unchanged.
4. If a condition differs from the above, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx
# Expected: 0 errors
```

**Out of scope:** ⋯ menu items (New Shipment, New Invoice, Convert Lines to Jobs, Reopen, Delete).

---

## Task 10: Disabled reasons on the RFQ and return order headers

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQHeader.tsx`: Ready for Quote (two variants, ~151 and ~169), Quote (~183), No Quote (~227)
- Modify: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderHeader.tsx`: Confirm (~182), Cancel (~193), Receive (~204), Ship (~219), Issue Credit (~235), Create Replacement (~260)

**Steps:**
1. Same imports and pattern as Task 9.
2. RFQ reasons:
   - Ready for Quote (customer variant): `[status !== "Draft", t\`Only draft RFQs can be marked ready for quote\`]`, `[lines.length === 0, t\`Add at least one line first\`]`, `[!canUpdate, t\`You don't have permission to update RFQs\`]`.
   - Ready for Quote (no-customer variant): use the actual status check in the code (`status !== "Ready for Quote"`). Message `t\`Only draft RFQs can be marked ready for quote\``, plus the same lines and permission entries.
   - Quote: `[status !== "Ready for Quote", t\`Mark the RFQ ready for quote first\`]`, `[lines.length === 0, t\`Add at least one line first\`]`, `[!canCreate, t\`You don't have permission to create quotes\`]`.
   - No Quote: `[status !== "Ready for Quote", t\`Mark the RFQ ready for quote first\`]`, `[!canUpdate, t\`You don't have permission to update RFQs\`]`.
3. Return order reasons:
   - Confirm: `[lines.length === 0, t\`Add at least one line before confirming\`]`, `[!canUpdate, t\`You don't have permission to update return orders\`]`.
   - Cancel: `[!canUpdate, …same…]`.
   - Receive and Ship: `[!permissions.can("create","inventory"), t\`You don't have permission to create inventory documents\`]`.
   - Issue Credit: `[!permissions.can("create","invoicing"), t\`You don't have permission to create credits\`]`.
   - Create Replacement: `[!permissions.can("create","sales"), t\`You don't have permission to create sales orders\`]`.
   - Skip `isCreatingDocument` / fetcher-busy terms; they are loading states.
4. Leave the `isDisabled` expressions unchanged. If a condition differs, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQHeader.tsx apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderHeader.tsx
# Expected: 0 errors
```

**Out of scope:** ⋯ menu items.

---

## Task 11: Extract and translate new strings

**Depends on:** Tasks 1–10
**Steps:**
1. `pnpm lingui:extract`, then `pnpm lingui:clean`.
2. Run the repo's `translate` skill to fill the empty `msgstr` entries for the new strings.

**Verify:**
```bash
grep -c 'msgid "Select at least one item to accept the quote"' packages/locale/locales/es/erp.po
# Expected: 1
```

**Out of scope:** retranslating existing strings.

---

## Task 12: Full gates + browser verification

**Depends on:** all
**Steps:**
1. Gates:
   ```bash
   pnpm exec turbo run typecheck --filter=erp --filter=@carbon/react
   cd apps/erp && pnpm exec vitest run app/modules/sales
   pnpm exec biome check apps/erp/app/modules/sales 'apps/erp/app/routes/share+/quote.$id.tsx' 'apps/erp/app/routes/api+/sales.digital-quote.$id.tsx' packages/react/src/DisabledReason.tsx
   ```
2. Browser (needs `crbn up` in this worktree; **ask the user before booting the stack**). Log in with the `auth` skill and walk through acceptance criteria 1–8 from the spec at 1440, 1024 and 390 px widths, taking screenshots into `.ai/scratch/e2e/`.
3. Write the carbon-design review summary (props audit, drift notes) in the final message.

**Verify:** every acceptance criterion is marked pass with screenshot evidence, or reported as failing with the output.
