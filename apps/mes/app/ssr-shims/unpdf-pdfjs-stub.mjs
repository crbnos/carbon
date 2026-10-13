// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Stub for `unpdf/pdfjs` — unpdf's bundled serverless PDF.js engine (1.5 MB).
 *
 * `@carbon/files/pdf` points unpdf at react-pdf's `pdfjs-dist` in the browser
 * (`definePDFJSModule`), so this app runs exactly ONE PDF.js engine. unpdf still
 * carries `import("unpdf/pdfjs")` as a never-reached fallback, and Vite emits
 * that as a lazy chunk in every deploy. Alias it away in the client build
 * only (`clientOnlyAlias` in vite.config.ts): the server has no other engine,
 * so there `unpdf/pdfjs` must stay real. The throw is only reachable if the
 * resolver above were ever removed.
 */
throw new Error(
  "unpdf/pdfjs is stubbed in the app bundle — @carbon/files/pdf must resolve PDF.js via react-pdf's pdfjs-dist"
);
