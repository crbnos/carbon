---
paths: ["apps/mes/vitest.config.ts"]
triggers: ["Plugin[]", "PluginOption"]
promoted: null
---
# Vite plugin wrappers preserve the caller's type

**Context:** Adding an ERP dependency refreshed pnpm peer resolutions, and CI then typechecked the MES Vitest config.

**Problem:** The helper declared its input and output as `Plugin[]` from its own `vite` import. On a clean Linux install, Lingui supplied `Plugin[]` from a different Vite peer instance. Vite's private type members made the two declarations incompatible even though the hooks work the same way.

**Rule:** A wrapper that only changes a plugin hook should infer and return the caller's plugin type. Cast locally only to inspect the hook shape; do not force another Vite instance's `Plugin[]` at the function boundary.

**Applies to:** Vitest and Vite plugin wrappers such as `apps/mes/vitest.config.ts`.
