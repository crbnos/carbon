---
paths: ["apps/*/vite.config.ts", "apps/*/app/ssr-shims/unpdf-pdfjs-stub.mjs"]
triggers: ["unpdf/pdfjs", "definePDFJSModule"]
promoted: null
---
# unpdf ships a dead 1.5 MB engine chunk unless aliased away

**Context:** `@carbon/files/pdf` uses unpdf but points it at react-pdf's `pdfjs-dist` in the browser (`definePDFJSModule`) so each bundle has one PDF.js engine.

**Problem:** unpdf's fallback `import("unpdf/pdfjs")` is never reached but is statically visible, so Vite emits its bundled serverless engine as a ~1.5 MB lazy chunk in every client build.

**Rule:** Any browser app consuming `@carbon/files/pdf` aliases `unpdf/pdfjs` to `app/ssr-shims/unpdf-pdfjs-stub.mjs` in its Vite config (both apps do). Verify with the built output: exactly one chunk should contain `GlobalWorkerOptions` + `PDFWorker`.

**Applies to:** `apps/{erp,mes}/vite.config.ts`, any new React Router app that reads PDFs client-side.
