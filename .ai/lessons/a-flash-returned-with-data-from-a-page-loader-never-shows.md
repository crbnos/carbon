---
paths: []
triggers: ["await flash(", "flashData(", "flashMiddleware"]
promoted: null
---
# A flash returned with `data()` from a page loader never shows

**Context:** The kanban scan (2026-10-19) returned `data(result, await flash(request, error(…)))` from its loader, and its page then navigated to the job with `window.location`.

**Problem:** The message never appeared. The root's `flashMiddleware` reads and clears the flash on every request. It ran on the scan's own document request and cleared the cookie the loader had just set. Typecheck and unit tests cannot see this; only the browser did.

**Rule:** To carry a message to another page, throw `redirect(path, await flash(request, …))` from the loader or action, as every other route does. Do not return a flash with `data()` from a page loader and expect a later page to show it.

**Applies to:** any loader or action that sets a flash for the page it sends the user to.
