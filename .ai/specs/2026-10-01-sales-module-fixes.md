# Sales module fixes

- **Status:** Awaiting approval
- **Date:** 2026-10-01
- **Branch:** `fix/sales-module`
- **Research:** N/A. Every item is an internal bug or UI-consistency fix with no ERP-domain logic to model. Root causes come from reading the code (paths below).

## Summary

Five independent fixes in Sales:

1. Repeated quantity breaks on a quote line share one price row.
2. The label column in the quote line Costing and Pricing tables is cramped and clips text.
3. The public quote page lets a customer accept an order with no items.
4. The Jobs rows on a sales order line have a large unexplained gap and a hover-only button.
5. Key Sales actions are disabled with no explanation.

## Goals

- A quote line can never hold two identical quantity breaks again. Existing ones display correctly.
- The Costing and Pricing label columns read cleanly with real-length labels at every pane width.
- A customer can drop individual items from a shared quote but can never place an empty order.
- The Jobs rows are compact and aligned, with no invisible controls taking up space.
- Each disabled header button tells the user, in plain words, why it is disabled.

## Non-goals

- No data migration for lines that already have repeated quantities (display-only fix; see Q4).
- No change to how currency conversion is shown. It is correct: it appears when the quote's currency differs from the company's base currency (`QuoteLinePricing.tsx:1461`).
- No tooltips on disabled ⋯ menu items, and none for "busy/loading" states (the spinner already explains those).
- No change to the shared `Hyperlink` component. Other screens rely on its hover "Open" button.
- No redesign of the expanded job operations panel (`JobDetails`).

## Design

### 1. Repeated quantity breaks

**Cause.** `quoteLinePrice` has `PRIMARY KEY ("quoteLineId","quantity")` (`packages/database/supabase/migrations/20240802114117_quote-line-quantities.sql:29`). The pricing grid reads and writes by quantity value (`QuoteLinePricing.tsx:614-626`). So the "10" columns in 10,10,10 all point at the same row, and editing one edits all of them.

- **Validator.** `quoteLineValidator.quantity` (`apps/erp/app/modules/sales/sales.models.ts:493`) gets a uniqueness refine with a translatable message, "Each quantity must be different". It shows under the field through `ArrayNumeric`'s `FormErrorMessage` (`packages/form/src/components/ArrayNumeric.tsx:104`). The edit route, the new-line route and the import share this validator, so they are all covered.
- **Display guard.** The pricing grid dedupes before rendering (`QuoteLinePricing.tsx:110`), and so does the line loader (`routes/x+/quote+/$quoteId.$lineId.details.tsx:164-166`). Lines that already have repeats render one column per distinct quantity, with no duplicate React keys.

### 2. Costing and Pricing label column

**Cause.** The first column only has `w-[300px]` on its header (`QuoteLineCosting.tsx:88`, `QuoteLinePricing.tsx:888`). The labels are `whitespace-nowrap` inside `HStack justify-between`, and the type badges (`Enumerable`, `MethodItemTypeIcon`, `TimeTypeIcon`) sit on the right with no `shrink-0`. The badges and labels compete for space, and the text overflows.

**New layout**, the same in both tables (revised after review):

- The label column is `min-w-[280px] w-[300px]` (`CostRowLabel.tsx` → `costRowLabelCellClass`). The label truncates with an ellipsis and shows a tooltip when cut off (`TruncatedTooltipText`).
- The existing right-side badges stay as they were: `Enumerable` on total rows, a `Badge` with the type icon on detail rows, and the Lead Time "Predict" button. They are `shrink-0` so they never cover the label.
- Value cells never wrap (`whitespace-nowrap`), and quantity columns are at least 140px wide, so the table scrolls sideways instead of squeezing.
- There is no sticky column; it let scrolled content show through translucent row backgrounds.

### 3. Public quote page: remove an item, never accept an empty order

**Cause.** Remove clears only its own line (`routes/share+/quote.$id.tsx:976-995`). This is intentional, from commit `08534638d1`: a customer can opt out of one item. But Accept is disabled only when `total === 0` (`:1354`). With a quote-level shipping charge, the total stays above 0 even when every item is removed. Neither `routes/api+/sales.digital-quote.$id.tsx` nor the `convert` edge function rejects an empty selection.

- **Label.** The button reads "Remove this item" (translatable). It is hidden when the quote has only one item (revised 2026-10-01): removing the only item just empties the quote, and Reject Quote already covers that.
- **Removed state.** When an item's quantity is 0, its collapsed header (`:476-500`) shows a muted "Removed" badge so the customer can see what they dropped. Choosing a quantity again restores it, as today.
- **Accept gate.** Accept is disabled when no item has quantity > 0, replacing `total === 0`. A tooltip on the disabled button says "Select at least one item to accept the quote", using the shared component from §5.
- **Server guard.**
  - `sales.digital-quote.$id.tsx` returns `{ success: false, message }` after validation (~`:93`) when no line has quantity > 0.
  - The `convert` function's quote-to-order case throws when `selectedQuoteLines.length === 0` (after `packages/database/supabase/functions/convert/index.ts:611`).
  - Together these mean no empty sales order is created and the quote status does not change.

### 4. Sales order Jobs rows

**Cause.** `SalesOrderJobItem` (`modules/sales/ui/SalesOrder/SalesOrderLineJobs.tsx:288-387`) wraps the job ID and its status badges in `Hyperlink`. `Hyperlink` always renders an invisible hover-only "Open" button that still takes up width (`components/Hyperlink.tsx:35-47`). That is the gap before "Unassigned".

**New row**, which keeps the expandable operations panel:

- The job ID is a plain readable-ID link (`whitespace-nowrap`). The status badges (`JobStatus` plus Due Today / Overdue) sit right after it and wrap rather than clip.
- Assignee, Complete, Shipped and the actions (Release, expand chevron) sit in aligned fixed columns, so every job row lines up.
- Narrow panes use container queries rather than viewport breakpoints, so the metrics drop below the identity line when the pane is narrow.
- The row is used in two places, the line Jobs card and `SalesOrderSummary.tsx:678-697`, and both get the fix. The `@ts-expect-error` at `SalesOrderSummary.tsx:692` is resolved if the new props make it unnecessary.

### 5. Disabled-reason tooltips

**Shared component.** There is none today, and disabled `<button>`s don't fire hover events. Add `DisabledReason` in `packages/react`:

- Props: `reason?: ReactNode`, `children`.
- No `reason`: render `children` unchanged.
- With a `reason`: wrap `children` in a focusable `<span tabIndex={0} className="inline-flex">` inside `Tooltip`/`TooltipTrigger asChild`, with the reason in `TooltipContent`.
- This is modelled on `ItemChangeNoticeLock.tsx:41-80` and `AssemblyBomTree.tsx:1733-1752`.

**Reason helper per header.** Each header computes a reason from the button's existing disabled condition, split into causes. The first cause that applies wins:

1. **Status**, e.g. "Only draft quotes can be finalized".
2. **No lines**, e.g. "Add at least one line first".
3. **Permission**, "You don't have permission to …".

Fetcher-busy and loading states get no reason. The disabled logic itself is unchanged; only the explanation is added.

**Buttons in scope:**

| Screen | Buttons | Current condition |
|---|---|---|
| Quote header | Finalize, Won, Lost, Cancel | `QuoteHeader.tsx:245-325` |
| Sales order header | Confirm, Cancel, Ship, Invoice | `SalesOrderHeader.tsx:413-449, 526-545, 595-614` |
| RFQ header | Ready for Quote (both variants), Quote, No Quote | `SalesRFQHeader.tsx:151-240` |
| Return order header | Confirm, Receive, Ship, Issue Credit, Create Replacement | `SalesReturnOrderHeader.tsx:182-274` |
| Convert-to-order drawer | Next ("Select at least one line to convert") | `QuoteToOrderDrawer.tsx:329-330, 390` |

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Repeated quantities on save | Reject with a form error | Shows the mistake to the user; one validator covers all entry paths (Q1). |
| Existing repeated data | Display-only dedupe, no migration | Doesn't rewrite stored records across companies (Q4). |
| Public quote Remove | Keep it, rename it, add a removed state, gate Accept, guard on the server | Keeps the intentional per-item opt-out and closes the empty-order hole (Q2). |
| Jobs layout | Tidy aligned rows, expandable operations kept | Keeps the inline operations panel (Q3). |
| `Hyperlink` | Not changed; the job row stops using it | The hover "Open" button is relied on by other screens. |
| Label column | Wider column, ellipsis, badges kept on the right | The badges carry meaning; the user asked for a width fix only (Q5, revised). |
| Tooltip scope | Header buttons plus the Convert "Next" button; no ⋯ items | Covers the important blocked actions without a large copy pass (Q6). |
| Tooltip mechanism | New shared `DisabledReason` in `packages/react` | No shared component exists. A span wrapper is the only way a disabled button gets hover; this matches two existing local copies. |
| Copy | Every new string goes through Lingui (`Trans` / `t`) | Project rule: all user-facing copy is translatable. |

## Acceptance criteria

1. Saving a quote line with quantities 10, 10, 25 fails with "Each quantity must be different" under the quantities field. Saving 10, 20, 25 succeeds.
2. A line already stored as 10, 10, 10 opens with one "10" column in Pricing, and the browser console has no duplicate-key warning.
3. In Costing and Pricing, with "Show Details" on, at pane widths of about 470 px and 1440 px, no label text is overlapped by an icon or button. A truncated label shows its full text on hover.
4. On a shared one-item quote, clicking "Remove this item" shows a "Removed" badge, and Accept is disabled with a tooltip "Select at least one item to accept the quote". This also holds when the quote has a shipping cost.
5. On a shared two-item quote, removing one item keeps Accept enabled. Accepting creates a sales order with one line, and the quote becomes Partial.
6. Posting an all-zero selection directly to the digital-quote endpoint returns `success: false`, creates no sales order, and leaves the quote status unchanged.
7. On a sales order line with a job, the job ID, status badges and "Unassigned" sit close together with no blank gap, and hovering the row reveals no hidden button. The rows look the same in the order summary.
8. Hovering, or tabbing to, each in-scope disabled button shows a plain-language reason. Examples: Finalize on a Sent quote says "Only draft quotes can be finalized". Ship on a Draft order explains that it needs confirming first. A user without update permission sees the permission reason.
9. Every new string has a Lingui catalog entry. Typecheck and lint pass for the touched packages.

## Open questions (resolved)

- [x] Q1. What happens when the same quantity is entered twice? **Answer:** Block the save with a form error.
- [x] Q2. How should the public-quote Remove button work? **Answer:** Rename it to "Remove this item", show a removed state, disable Accept with a reason when no item is selected, and reject empty selections on the server.
- [x] Q3. What layout for the Jobs rows? **Answer:** Tidy aligned rows that keep the expandable operations panel.
- [x] Q4. Clean up lines already saved with repeated quantities? **Answer:** No migration; dedupe on display only.
- [x] Q5. How should the label column handle long labels? **Answer:** Icon before the label, truncating label with a tooltip, sticky min-width column. **Revised 2026-10-01 after seeing it in the browser:** keep the badges on the right, widen the column, and use an ellipsis; no sticky column.
- [x] Q6. Tooltip scope? **Answer:** Header buttons plus the Convert "Next" button; ⋯ menu items stay out of scope.

## Changelog

- 2026-10-01: Spec written after the Q1–Q6 interview. Awaiting approval.
