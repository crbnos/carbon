---
paths: []
triggers: []
promoted: null
---
# A JSON import attribute fixes the server and breaks the browser

**Context:** `@carbon/react` loads each DiceBear style's JSON with `import()` (`packages/react/src/utils/generatedAvatar.ts`). The same code runs in the browser (the avatar picker) and on the server (the `/file/avatar/:value` route).

**Problem:** On the server, Vite leaves a dependency's import external, and Node refuses JSON without `with: { type: "json" }` (`ERR_IMPORT_ATTRIBUTE_MISSING`). Adding the attribute fixed the route. But Vite passes the attribute through to the browser's `import()`, and serves the JSON as `text/javascript`, so the browser rejected every style and the picker previews stayed grey (2026-10-08). Typecheck, unit tests and the server route all passed; only the browser saw it.

**Rule:** Never put an import attribute on a JSON import in code that also runs in the browser. Make the server bundle the package instead: add it to `ssrNoExternal` in each app's `vite.config.ts` (the ERP and MES lists apply to both `ssr.noExternal` and `environments.ssr.resolve.noExternal`). To check the browser side, fetch the module from the dev server (`curl $ERP_URL/@fs<absolute path>`) and confirm the `import()` call has no second argument.

**Applies to:** `packages/react/src/utils/generatedAvatar.ts`; any isomorphic code that imports JSON from a dependency.
