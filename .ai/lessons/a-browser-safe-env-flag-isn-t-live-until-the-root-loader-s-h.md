---
paths: ["apps/erp/app/root.tsx", "apps/mes/app/root.tsx", "packages/env/src/index.ts"]
triggers: ["getBrowserEnv", "window.env"]
promoted: null
---
# A browser-safe env flag isn't live until the root loader's hand-built `env` also carries it

**Context:** The Stripe Connect integration card stayed "Coming soon" even with `STRIPE_SECRET_KEY` set server-side. `getBrowserEnv()` (`packages/env/src/index.ts`) already exposed `STRIPE_CONNECT_ENABLED` and the `Window.env` interface declared it, so it looked fully wired — but the browser gate `window.env?.STRIPE_CONNECT_ENABLED === "true"` still read `undefined`.

**Problem:** `apps/erp/app/root.tsx`'s loader does NOT pass `getBrowserEnv()` through — it destructures specific keys and rebuilds an `env: { ... }` object by hand, and `window.env` is populated from THAT loader object on the normal render path (`const env = loaderData?.env ?? {}` → `<Document env={env}>`). The new flag was added to `getBrowserEnv()` but never added to the loader's manual list, so it was silently dropped client-side. (The ErrorBoundary path uses `getBrowserEnv()` directly, which masks the gap during casual reading.)

**Rule:** Adding a browser-safe var is THREE edits, not one: the `getEnv` export, `getBrowserEnv()` + the `Window.env` interface, AND the consuming app's root-loader `env` object (destructure + literal) for every app that needs it client-side. The loader's hand-curated `env` is the real source of `window.env` on the happy path — a key present in `getBrowserEnv()` but absent there is `undefined` in the browser. When an env-driven feature is dark despite the server value being set, diff `getBrowserEnv()`'s keys against the loader's `env` object before touching anything else.

**Applies to:** `apps/erp/app/root.tsx` (and `apps/mes/app/root.tsx`) loader `env` objects, `packages/env/src/index.ts` `getBrowserEnv()`, any `window.env`-gated integration/feature flag.
