---
paths: ["apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx"]
triggers: ["useRuleViolations"]
promoted: null
---
# A flash on a fetcher's redirect back to the same page is never shown

**Context:** Refusing a receipt post that still misses serial numbers (2026-10-16). The Post dialog submits through `useRuleViolations`, a fetcher.

**Problem:** The action threw `redirect(path.to.receipt(id), await flash(...))`. The redirect lands on the pathname already on screen, so the root's `shouldRevalidate` (`isSearchParamOnlyNavigation`) skips the root loader, and the root is what reads the flash and shows the toast. The post was refused correctly, but the user saw nothing happen. The route's older flash errors ("Failed to post receipt") have the same gap.

**Rule:** An action submitted through a fetcher returns its error as data (`{ error: { message } }`, which `useRuleViolations` toasts), not as a flash on a redirect to the current page. A flash is for a redirect that navigates somewhere else.

**Applies to:** Post / void / approve actions behind a modal or `useRuleViolations` (`receipt+/$receiptId.post.tsx` and its siblings).
