---
paths: []
triggers: []
promoted: null
---
# A prefix short-circuit in the server entry outranks every route under it

**Context:** `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` each have a route, and each returned an empty **204** in production instead of its JSON. The MCP endpoint hands clients the first of those URLs in its 401 `WWW-Authenticate` header (`api+/mcp+/_index.ts:63`), so OAuth discovery for the remote connector was dead.

**Problem:** `apps/erp/server/app.ts` wrapped `createRequestHandler` with `if (pathname.startsWith("/.well-known/")) return new Response(null, { status: 204 })` — added to keep browser probes out of the dev logs, with the comment "no app route". That was true when it was written; three `.well-known` routes were added later and every one of them became unreachable, because the short-circuit runs BEFORE the router.

**Rule:** A path check in the server entry silently outranks routing for everything under it. If you short-circuit a prefix, derive the exemptions from the build manifest (`build.routes`) rather than assuming the prefix stays route-free — a comment asserting "no app route" is a claim that rots the moment somebody adds one. Three false leads to skip next time this shape appears: it reproduces identically on Vercel AND `react-router-serve` (so it is not the platform); `/.foo` and `/.env` return normal 404s (so it is not dotfile handling); and `matchRoutes` against the full route table picks the RIGHT route and passes WITH the bug present (so a matcher test proves nothing). The tell was that percent-encoding the dot (`/%2Ewell-known/...`) returned `200 application/json` — `new URL().pathname` leaves the escape undecoded so `startsWith` missed, while the router decodes and matched.

**Applies to:** `apps/erp/server/app.ts`, `apps/mes/server/*`, and any request-handler wrapper that inspects `pathname` before delegating.
