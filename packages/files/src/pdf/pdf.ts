// PDF *reading*: text extraction, metadata, page rasterisation. Generation
// (react-pdf templates) is a document concern and lives in @carbon/documents.
//
// Built on unpdf, which ships a serverless PDF.js build with the worker
// inlined — so this runs identically in Node, Deno edge functions, and
// Workers with no worker-file plumbing. Browser *rendering* is separate:
// react-pdf carries its own PDF.js instance, registered via `./worker`.
import {
  definePDFJSModule,
  extractText,
  getDocumentProxy,
  getMeta
} from "unpdf";

export const PDF_CONTENT_TYPE = "application/pdf";

// One PDF.js engine per bundle. In the browser react-pdf hard-imports
// `pdfjs-dist`, so point unpdf at that same module (the bundler dedupes) instead
// of shipping its bundled copy alongside; react-pdf's worker registration then
// covers both (see ./worker). On the server unpdf's inlined serverless build is
// the only engine, so nothing to do. Lazy so importing this module never
// eagerly pulls the engine chunk into the importer's load.
let engineConfigured: Promise<void> | null = null;
function configured(): Promise<void> {
  engineConfigured ??=
    typeof document !== "undefined"
      ? definePDFJSModule(() => import("pdfjs-dist"))
      : Promise.resolve();
  return engineConfigured;
}

type PdfBytes = ArrayBuffer | Uint8Array;

// pdfjs rejects Node `Buffer` by constructor check even though it is a
// Uint8Array subclass, so always hand it a plain view over the same memory.
const toBytes = (data: PdfBytes): Uint8Array =>
  data instanceof Uint8Array
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);

/**
 * Whole-document text with `--- Page N ---` separators — the shape the AI
 * extraction prompts consume.
 */
export async function extractPdfText(
  data: PdfBytes
): Promise<{ text: string; pageCount: number }> {
  await configured();
  const { text, totalPages } = await extractText(toBytes(data));
  return {
    text: text
      .map((page, index) => `--- Page ${index + 1} ---\n${page}\n\n`)
      .join(""),
    pageCount: totalPages
  };
}

/** Per-page text, without separators. */
export async function extractPdfPages(data: PdfBytes): Promise<string[]> {
  await configured();
  const { text } = await extractText(toBytes(data));
  return text;
}

/**
 * Fully release a document opened with `openPdf`. `cleanup()` only frees page
 * resources — the loading task (transport, worker port) must be destroyed or
 * every opened document leaks; unpdf's own helpers do exactly this. The typed
 * surface hides `loadingTask`, hence the cast.
 */
export async function closePdf(pdf: {
  cleanup(keepLoadedFonts?: boolean): Promise<unknown>;
}): Promise<void> {
  await (
    pdf as unknown as { loadingTask: { destroy(): Promise<void> } }
  ).loadingTask.destroy();
}

export async function getPdfPageCount(data: PdfBytes): Promise<number> {
  const pdf = await openPdf(data);
  try {
    return pdf.numPages;
  } finally {
    await closePdf(pdf);
  }
}

/**
 * Open a document for page-level work (rendering with overlays, custom
 * iteration). Caller owns it: `await closePdf(pdf)` when done.
 */
export async function openPdf(data: PdfBytes) {
  await configured();
  return getDocumentProxy(toBytes(data));
}

/** Document info dictionary (Title, Author, CreationDate as Date, …). */
export async function getPdfMeta(
  data: PdfBytes
): Promise<Record<string, unknown>> {
  await configured();
  const { info } = await getMeta(toBytes(data), { parseDates: true });
  return info;
}
