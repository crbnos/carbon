---
paths: ["packages/auth/src/utils/http.ts", "apps/*/app/routes/**/login*.tsx", "apps/*/app/routes/**/callback.tsx"]
triggers: ["getCurrentPath", "makeRedirectToFromHere", "redirectTo="]
promoted: null
---
# "Come back here" must carry the query string

**Context:** Notification emails link to `/api/link?event=…&documentId=…&companyId=…`, and `requireAuthSession` sends a request away and back for a token refresh, login, MFA or idle unlock.

**Problem:** `getCurrentPath` returned `pathname` only, so every one of those round trips came back to a bare `/api/link`, which has nothing to resolve and redirects to the home page. The link itself was correct, and it worked on a second click (the token was fresh by then), so it read as an email bug. The token-refresh branch hit anyone idle for longer than the refresh threshold, which is the normal state of someone arriving from an email.

**Rule:** A "return to where you were" target is `pathname + search`, never `pathname`. When it is passed on inside another URL, encode it (`encodeURIComponent` / `URLSearchParams`), or its own `&` splits it. Test the round trip with a URL that has a query string. Drop React Router's `_routes` param from it, and only when present: middleware sees that param (loaders do not), a page URL that carries it limits which loaders later data requests run, and `searchParams.delete` re-encodes the whole query even when it removes nothing. Whatever sends the target on must be matched by something that reads it: three of the four callbacks ignored the `redirectTo` their login page sent.

**Applies to:** `packages/auth/src/utils/http.ts` (`getCurrentPath`, `makeRedirectToFromHere`), `requireAuthSession` / `refreshAuthSession`, every app's `login.tsx` callback URL and the `callback.tsx` that consumes it.
