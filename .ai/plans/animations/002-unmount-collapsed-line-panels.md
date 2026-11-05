# 002 — Unmount collapsed line panels so hidden pricing controls leave the tab order

- **Status**: DONE (`share+/supplier-quote.$id.tsx` done differently, see below)
- **Commit**: 2089c5b
- **Severity**: MEDIUM
- **Category**: Accessibility (motion implementation)
- **Estimated scope**: 9 files, one block each

## Problem

The document summaries and the public share pages collapse a line's detail panel by
animating it to `height: 0, opacity: 0` — and leave it mounted. Everything inside
stays in the DOM: the quantity-break radios and inputs (`LinePricingOptions` on the
quote and supplier-quote pages) can still be reached with Tab, are read by screen
readers, and a keyboard user lands on an invisible control.

```tsx
// apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceSummary.tsx:256 — current
<motion.div
  initial={false}
  animate={openItems.includes(line.id) ? "open" : "collapsed"}
  variants={{
    open: { opacity: 1, height: "auto", marginTop: 16 },
    collapsed: { opacity: 0, height: 0, marginTop: 0 }
  }}
  transition={{ duration: 0.2 }}
  className="w-full overflow-hidden"
>
  …panel content…
</motion.div>
```

The same block (same variants, `transition={{ duration: 0.2 }}`) is at:

| File | Line of `initial={false}` |
| --- | --- |
| `apps/erp/app/modules/sales/ui/Quotes/QuoteSummary.tsx` | 152 |
| `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderSummary.tsx` | 622 |
| `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceSummary.tsx` | 257 |
| `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceSummary.tsx` | 238 |
| `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderSummary.tsx` | 264 |
| `apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteSummary.tsx` | 113 |
| `apps/erp/app/routes/share+/quote.$id.tsx` | 597 |
| `apps/erp/app/routes/share+/supplier-quote.$id.tsx` | 437 |
| `apps/erp/app/routes/share+/purchasing-rfq.$id.tsx` | 232 |

## Target

Mount the panel only while open, and animate enter/exit with `AnimatePresence`:

```tsx
<AnimatePresence initial={false}>
  {openItems.includes(line.id) ? (
    <motion.div
      key="panel"
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: "auto", marginTop: 16 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="w-full overflow-hidden"
    >
      …panel content, unchanged…
    </motion.div>
  ) : null}
</AnimatePresence>
```

`ease: [0.23, 1, 0.32, 1]` is the strong ease-out curve already used across the app
(`NavRail.tsx`, `CollapsibleSidebar.tsx`). Keep the open condition expression exactly
as each file writes it (some use `openItems.includes(line.id)`, some a local variable).

## Repo conventions to follow

- Exemplar: `apps/erp/app/components/SortableList.tsx:473-486` — `AnimatePresence
  initial={false}` around a conditionally rendered `motion.div key="panel"` with
  `initial/animate/exit` height + opacity. Copy that shape.
- Import `AnimatePresence` alongside `motion`: `import { AnimatePresence, motion } from "motion/react";`.

## Steps

For each of the 9 files:

1. Add `AnimatePresence` to the existing `motion/react` import.
2. Replace the `<motion.div initial={false} animate={… ? "open" : "collapsed"} variants={…} transition={{ duration: 0.2 }} className="w-full overflow-hidden">`
   opening tag with the `AnimatePresence` + conditional + `motion.div` from Target,
   using the same open condition.
3. Close the conditional and `AnimatePresence` after the matching `</motion.div>`.
4. Do not touch the chevron `motion.span`/`motion.div` that rotates 90° — it stays.

## Boundaries

- Do NOT change what is inside the panel.
- Do NOT change the chevron rotation or the line row markup.
- Do NOT add dependencies. Do NOT touch `SortableList.tsx`.
- If a file's block does not match the excerpt (drift since 2089c5b), STOP and report that file.

## Verification

- **Mechanical**: `pnpm exec turbo run typecheck --filter=erp` → 0 errors;
  `pnpm exec biome check <the 9 files>` → clean.
- **Feel check** (open a quote → Summary, and a public quote share link):
  - Collapse a line, then press Tab through the page: focus never lands inside the
    collapsed line.
  - Expand/collapse rapidly 5 times: the panel never gets stuck half-open, and the
    rows below move smoothly.
  - At 10% playback (DevTools → Animations) the panel grows from 0 and shrinks back to 0
    before it is removed — no snap at the end of the exit.
  - Toggle `prefers-reduced-motion` (Rendering panel): the panel appears and disappears
    without a height animation (the root `<MotionConfig reducedMotion="user">` handles it).
- **Done when**: none of the 9 files contains `collapsed: { opacity: 0, height: 0`.

## Deviation: `share+/supplier-quote.$id.tsx` keeps its panel mounted

Its panel renders `LinePricing`, which keeps the supplier's typed prices in
local state (`pricingByQuantity`, seeded from `quoteLinePrices`). Unmounting
the panel would drop unsaved edits on collapse. The panel stays mounted and the
collapsed variant ends with `transitionEnd: { display: "none" }`, which takes
it out of the tab order and the accessibility tree once the collapse finishes
(with `initial={false}`, Motion applies `transitionEnd` on the first render too).
