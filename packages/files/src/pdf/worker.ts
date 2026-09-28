// Browser-only: the bundler-resolved pdfjs worker URL (Vite `?url`). Kept in
// its own module so the static import is synchronous — react-pdf's
// `<Document>` may render on first paint, before any async registration
// could settle and would silently fall back to a main-thread fake worker.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Point react-pdf's bundled pdfjs at the worker. Call once per app in the
 * client entry — react-pdf ships its own pdfjs instance, and that instance
 * (not the one `./pdf` loads for text extraction) is what `<Document>` and
 * any browser code importing `pdfjs` from "react-pdf" use.
 */
export function registerReactPdfWorker(pdfjs: {
  GlobalWorkerOptions: { workerSrc: string };
}): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}
