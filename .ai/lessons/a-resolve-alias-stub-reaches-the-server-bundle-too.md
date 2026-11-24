---
paths: []
triggers: []
promoted: null
---
# A `resolve.alias` stub reaches the server bundle too

**Context:** Both apps aliased `unpdf/pdfjs` to a throwing stub to keep unpdf's 1.5 MB engine out of the browser bundle, where react-pdf's `pdfjs-dist` is used instead.

**Problem:** A top-level `resolve.alias` applies to every Vite environment. On the server `unpdf/pdfjs` is the only PDF engine, so every deployed document extraction (purchase invoice, sales RFQ) failed with "Serverless PDF.js bundle could not be resolved". Dev and vitest passed: dev leaves `unpdf` external, so Node resolves the real module and the alias never applies.

**Rule:** A stub that exists to shrink the client bundle goes through `clientOnlyAlias` (`@carbon/dev/vite`), never `resolve.alias`. Verify a server-side dependency change against a bundle built with `ssr.noExternal: true`, not against the dev server.

**Applies to:** `apps/{erp,mes}/vite.config.ts`, `app/ssr-shims/`, `packages/dev/vite.js`.
