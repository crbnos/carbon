# Animation plans

Written by the `improve-animations` pass (Emil Kowalski's skills) at commit `2089c5b`,
after the `remove-animations` pass in the same commit range. Each plan is
self-contained: an executor needs no other context.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Scale context menus from the cursor](001-context-menu-transform-origin.md) | MEDIUM | DONE |
| 002 | [Unmount collapsed line panels](002-unmount-collapsed-line-panels.md) | MEDIUM | DONE |
| 003 | [Show hover-revealed controls on focus](003-reveal-hover-controls-on-focus.md) | MEDIUM | DONE |
| 004 | [Easing tokens + drawer curve](004-motion-easing-tokens.md) | MEDIUM | DONE |
| 005 | [Invite page: visible focused Join button](005-invite-page-reveal.md) | MEDIUM | DONE |

## Recommended order

1. **001**: one file, no risk, and you can see the result straight away.
2. **003**: four class strings; an accessibility fix.
3. **002**: nine files, same mechanical edit; an accessibility fix.
4. **005**: one page.
5. **004**: last. It redefines the `ease-out` / `ease-in-out` utilities app-wide, so
   run it after the others land, then do a broad feel check.

## Dependencies

- 002 hard-codes `ease: [0.23, 1, 0.32, 1]` (a JS array for Motion, not a Tailwind class), so it does not depend on 004.
- None of the others depend on each other.

## Not planned (found, lower leverage)

- Keyframe classes with no keyframes defined, so they do nothing:
  - `animate-caret-blink` (`packages/react/src/InputOTP.tsx:64`)
  - `animate-slide-up-fade` (`packages/react/src/FunnelChart.tsx:192`)
  - `animate-tile-scroll` (`apps/erp/app/components/Gantt/Gantt.tsx:1374`, `:1653`)
  - `animate-fade-in` (`apps/erp/app/modules/sales/ui/Quotes/QuoteHeader.tsx:473`)
- BOM/BOP action bar `motion.div layout` (for example `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx:1236`): this may be hiding a layout jump, and it moves the Save button while you reach for it. Remove it only after a visual check.
- `ItemFilterSelector.tsx:175-188`: the AND/OR toggle fades in with no height animation, so the block below jumps by about 40px.
- The Traceability graph (`TraceabilityGraph.tsx:640`) and Element graph (`ElementGraph.tsx:504`) stay at `opacity: 0` until a fit runs. If the first render is empty or zero-sized, `fitted` is never set and the graph stays blank.
