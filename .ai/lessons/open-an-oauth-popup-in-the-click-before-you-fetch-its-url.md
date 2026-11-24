---
paths: []
triggers: []
promoted: null
---
# Open an OAuth popup in the click, before you fetch its URL

**Context:** Install and Add account on a workflow piece card (`startIntegrationConnect`, `packages/ee/src/integrations/connect.ts`) fetch the consent URL from the connect route, then open it in a popup.

**Problem:** The old code awaited the fetch and then called `window.open`. The await can outlive the click's transient user activation, so Chrome blocked the popup without an error, and Install looked like it did nothing.

**Rule:** Call `beginOAuthPopup()` (`packages/ee/src/oauth-popup.ts`) synchronously in the click handler, before any await. Then fetch the URL and call `navigate(url)` on the handle. If the fetch fails, call `close()`. If the browser blocked the popup anyway, `navigate` falls back to the current window.

**Applies to:** every consent or payment flow that opens a window after a request: the piece cards, the Onshape connect, any new OAuth integration.
