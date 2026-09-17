/**
 * Stub for `unpdf/pdfjs` — unpdf's bundled serverless PDF.js engine (1.5 MB).
 *
 * `@carbon/files/pdf` points unpdf at react-pdf's `pdfjs-dist` in the browser
 * (`definePDFJSModule`), so this app runs exactly ONE PDF.js engine. unpdf still
 * carries `import("unpdf/pdfjs")` as a never-reached fallback, and Vite emits
 * that as a lazy chunk in every deploy. Alias it away; the throw is only
 * reachable if the resolver above were ever removed.
 */
throw new Error(
  "unpdf/pdfjs is stubbed in the app bundle — @carbon/files/pdf must resolve PDF.js via react-pdf's pdfjs-dist"
);
