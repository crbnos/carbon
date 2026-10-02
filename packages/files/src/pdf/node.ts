// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Node-only: rasterise a PDF page to a PNG.
//
// Separate from `./pdf.ts` because the canvas backend is a NATIVE addon.
// `@napi-rs/canvas` is an optional peer of unpdf precisely so a browser or Deno
// consumer never pulls it; keeping the import in its own module means the
// client bundle never sees it either, which is the trap `./worker.ts` and
// `apps/erp/app/ssr-shims/unpdf-pdfjs-stub.mjs` exist for — a top-level alias
// or a stray dynamic import reaches every Vite environment, not just the one
// you meant.
//
// Why rasterise at all: the MES mobile app has no PDF engine. `react-pdf` and
// `react-konva` are DOM-only, so an inspector's drawing is rendered here and
// sent as an image, with the balloon overlay drawn natively on top from the
// normalized coordinates in `@carbon/utils/balloons`. Those coordinates are
// 0–1 relative to the page, so they survive any render scale.
import { renderPageAsImage } from "unpdf";

/**
 * Render one page of a PDF as PNG bytes.
 *
 * `scale` multiplies the page's natural size. The caller picks it: the balloon
 * coordinates are normalized, so scale affects only how much detail an
 * inspector can pinch into, never where a balloon lands.
 *
 * Throws when the page does not exist, or when the native canvas backend is
 * missing — both are the caller's to turn into a response.
 */
export async function renderPdfPageAsPng(
  data: ArrayBuffer | Uint8Array,
  pageNumber: number,
  options: { scale?: number } = {}
): Promise<Uint8Array> {
  // pdfjs rejects a Node `Buffer` by constructor check even though it is a
  // Uint8Array subclass, so hand it a plain view over the same memory — the
  // same reason `./pdf.ts` has `toBytes`.
  const bytes =
    data instanceof Uint8Array
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);

  const png = await renderPageAsImage(bytes, pageNumber, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale: options.scale ?? 2
  });
  return new Uint8Array(png);
}
