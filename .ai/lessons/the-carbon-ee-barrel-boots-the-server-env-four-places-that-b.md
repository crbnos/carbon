---
paths: ["packages/ee/src/index.ts", "packages/ee/src/sync/**", "packages/jobs/src/inngest/functions/integrations/topology.ts"]
triggers: ["from \"@carbon/ee\"", "vi.mock(\"@carbon/ee\"", "import(\"@carbon/ee\")"]
promoted: null
---
# The `@carbon/ee` barrel boots the server env — four places that breaks

**Context:** Adding `providerRole` + `IntegrationTopology` (`.ai/plans/implemented/2026-09-23-provider-roles-topology.md`).
Consumers across `@carbon/jobs`, `apps/erp` and tests needed the registry lookup
`getIntegrationIdsByRole` / `resolveIntegrationTopology`.

**Problem:** `packages/ee/src/index.ts` imports every integration descriptor, and
`ramp/config.tsx` imports `RAMP_CLIENT_ID` from `@carbon/auth`, which validates
the FULL server env at import time. So a plain `import … from "@carbon/ee"`
fails in four distinct ways, each with a different symptom:

1. **In a `*.service.ts`** — these were re-exported through the module barrel that
   client components import, so they were browser-bundled. The build fails with
   "server-only module referenced by client". (The barrels are gone since
   2026-10-16; a service file reaches the browser now only through a route
   component that uses one of its values — see "A server-only value in a route
   component, or a dropped side-effect import, fails only the production build".) (`accounting.service.ts` cannot use
   the registry at all; its id list stays hard-coded with a comment saying why.)
2. **In a test** — `Error: INNGEST_SIGNING_KEY is not set` at import. Hit three
   times: a test importing the barrel directly, a test importing a module that
   imports it, and a jobs test importing a module whose sibling did.
3. **As a lazy `await import("@carbon/ee")`** — moves the failure from module
   load to CALL time, which looks fixed until a test actually exercises the path.
4. **Via a `vi.mock("@carbon/ee", …)` fixture** — the mock lists exports
   explicitly, so adding a registry call to a loader breaks any test mocking it
   with `No "X" export is defined on the "@carbon/ee" mock`.

**Rule:** Keep decision cores free of the barrel. Put shared logic in an
import-light module (`packages/ee/src/sync/**` imports no `@carbon/auth`) and
take the registry slice as an ARGUMENT — `buildIntegrationTopology(rows,
descriptors)`, not `buildIntegrationTopology(rows)`. Only ENTRY POINTS (Inngest
functions, route loaders/actions) import the barrel and inject what they read;
give that import its own tiny module (`jobs/…/integrations/topology.ts`) so the
blast radius is one file. When you add a registry call to a loader, grep for
`vi.mock("@carbon/ee"` and extend those fixtures in the same change. Precedent
for the same shape elsewhere: `events/sync-tables.ts` and
`accounting/core/subscriptions.ts` are both deliberately import-light.

**Applies to:** `packages/ee/src/index.ts` consumers; `packages/ee/src/sync/**`;
`packages/jobs/src/inngest/functions/**`; any `apps/erp` `*.service.ts`; any test
mocking `@carbon/ee`.
