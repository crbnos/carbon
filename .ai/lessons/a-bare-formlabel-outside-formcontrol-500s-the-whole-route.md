---
paths: []
triggers: []
promoted: null
---
# A bare FormLabel outside FormControl 500s the whole route

**Context:** The returns-module line forms (`SalesReturnOrderLineForm`, `PurchaseReturnOrderLineForm`) used `<FormLabel>` as a standalone section heading for the tracked-entity picker area.

**Problem:** `FormLabel` (`packages/react/src/Form/FormLabel.tsx`) calls `useFormControlContext()`, which **throws** outside a `<FormControl>`. The throw happens at render, so the route's error boundary replaces the page — the user sees "Error 500. Something broke on our end." on an otherwise-valid URL. Subtler: when the crash is below a `ValidatedForm`, the form unmounts, so a page can LOOK fine in a stale snapshot while its Save button is dead. The error is only visible in the browser console (`useFormControlContext() must be used inside of a FormControl`); the server log shows nothing useful.

**Rule:** `FormLabel`/`FormError` are only valid inside a `<FormControl>`. For a standalone section heading in a form, use a plain `<label>`/heading element. When a page 500s with no server error, check the browser console for context-hook throws before suspecting the loader — and treat "form renders but Save does nothing" as a possible sibling-render crash, not a submit bug.

**Applies to:** any usage of `packages/react/src/Form/{FormLabel,FormError}.tsx`; form components under `apps/erp/app/modules/*/ui/`.
