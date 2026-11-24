---
paths: []
triggers: []
promoted: null
---
# `apps/erp` targets ES2019, so `packages/workflows` cannot use BigInt literals

**Context:** The workflow engine needed a stable 64-bit hash for batch item keys,
and the plan specified FNV-1a via `BigInt`.

**Problem:** `apps/erp/tsconfig.json` sets `"target": "ES2019"` and compiles
workspace package **source**, not built output. A `0xcbf29ce484222325n` literal
in `packages/workflows` fails the erp typecheck with TS2737 even though the
package's own `tsc --noEmit` passes — the package config targets `esnext`.

**Rule:** Anything in a package `apps/erp` imports must be ES2019-safe. Reach for
`Math.imul` and two 32-bit passes rather than one 64-bit BigInt pass. Always run
`pnpm exec turbo run typecheck --filter=erp` after touching a shared package —
the package's own typecheck is not the binding constraint.

**Applies to:** every `packages/*` that `apps/erp` imports; `packages/workflows`
doubly so, since the phase-7 builder also compiles it for the browser
(no `node:crypto` either).
