---
paths: []
triggers: []
promoted: null
---
# react-aria compares `formatOptions` by reference — an inline literal wipes half-typed numbers

**Context:** Any `NumberField` / `Number` / `NumberControlled` field that passes `formatOptions={{ ... }}` at the call site (real case: the MES Log Completed quantity in `apps/mes/app/components/JobOperation/components/QuantityModal.tsx`, where operators could not enter `1.5`).

**Problem:** `useNumberFieldState` (`@react-stately/numberfield`) guards with `formatOptions !== prevFormatOptions` — a **reference** check — and on a change calls `setInputValue(format(numberValue))`, replacing whatever is in the input with the last *committed* number. `react-aria-components`' `NumberField` spreads caller props straight through, so an inline object literal is a new reference every render. Any parent re-render while the user is mid-edit destroys the in-progress text. Commit only happens on blur/Enter/stepper, so a single digit usually survives but a decimal (`1.` → `1.5`, two-plus keystrokes) reliably does not. It reads as "the field doesn't support decimals" even though the format options, the zod validator, and the numeric DB column all allow them.

**Rule:** Never let an unstable `Intl.NumberFormatOptions` reference reach react-aria. `packages/react/src/Number.tsx`'s `NumberField` now stabilizes it via `useStableFormatOptions` / `areNumberFormatOptionsEqual` (shallow value compare — exact, since the options are all primitives), so call sites are free to pass literals. If you build another react-aria wrapper that forwards `formatOptions`, do the same; do not "fix" this class of bug by only adding/adjusting `formatOptions` at the call site — that is what introduced it here. Also note the same trap for any react-aria prop compared by identity.

**Applies to:** `packages/react/src/Number.tsx`; every `formatOptions={{ ... }}` call site in `apps/erp` / `apps/mes` (~144); `packages/form/src/components/{Number,NumberControlled,ArrayNumeric}.tsx`, whose `rest.formatOptions ?? ({ ... })` default also allocates a fresh object each render.
