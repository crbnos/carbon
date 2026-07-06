import { pdfjs } from "react-pdf";

/** Extra resolution for vision / OCR vs on-screen PDF preview. */
const VISION_RENDER_SCALE = 1.75;
/** Cap raster width so very large displays do not allocate huge canvases. */
const MAX_VISION_RASTER_WIDTH_PX = 4096;
/** Pad crop by this fraction of max(width,height) on each side (percent space). */
const CROP_PAD_FRAC = 0.1;
const CROP_PAD_MAX_PCT = 4;
const CROP_PAD_MIN_PCT = 0.3;
/** Minimum crop width/height in percent-of-page so tiny boxes stay readable. */
const CROP_MIN_SIZE_PCT = 2.5;

export type InspectionAnchorCropArgs = {
  pdfBytes: ArrayBuffer;
  pageNumber: number;
  /** 0–100, same coordinate system as `SelectorRect` in the inspection editor */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Horizontal size in CSS px of one rendered page (matches `react-pdf` `Page` `width={renderedWidth}`).
   * Viewport scale is derived so raster width matches this value times an internal vision scale (capped).
   */
  renderedPageWidthPx: number;
};

/**
 * Expands the anchor rect with padding, enforces a minimum size, and clamps to the page (0–100 %).
 */
function prepareVisionCropRect(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const w0 = Math.max(1e-6, width);
  const h0 = Math.max(1e-6, height);
  const mx = Math.max(w0, h0);
  const pad = Math.min(
    CROP_PAD_MAX_PCT,
    Math.max(CROP_PAD_MIN_PCT, CROP_PAD_FRAC * mx)
  );

  const cx = x + w0 / 2;
  const cy = y + h0 / 2;
  let w = w0 + 2 * pad;
  let h = h0 + 2 * pad;

  w = Math.max(w, CROP_MIN_SIZE_PCT);
  h = Math.max(h, CROP_MIN_SIZE_PCT);

  w = Math.min(w, 100);
  h = Math.min(h, 100);

  let nx = cx - w / 2;
  let ny = cy - h / 2;
  nx = Math.max(0, Math.min(nx, 100 - w));
  ny = Math.max(0, Math.min(ny, 100 - h));

  return { x: nx, y: ny, width: w, height: h };
}

/**
 * Renders one PDF page at higher resolution than the editor preview, then crops the (padded, min-sized) anchor rectangle to PNG.
 */
export async function cropInspectionAnchorToPngBlob(
  args: InspectionAnchorCropArgs
): Promise<Blob> {
  const { pdfBytes, pageNumber, x, y, width, height, renderedPageWidthPx } =
    args;

  const {
    x: rx,
    y: ry,
    width: rw,
    height: rh
  } = prepareVisionCropRect(x, y, width, height);

  const data = new Uint8Array(pdfBytes);
  const pdf = await pdfjs.getDocument({ data }).promise;

  try {
    const page = await pdf.getPage(pageNumber);
    const baseVp = page.getViewport({ scale: 1 });
    const targetWidth = Math.min(
      Math.max(1, Math.floor(renderedPageWidthPx * VISION_RENDER_SCALE)),
      MAX_VISION_RASTER_WIDTH_PX
    );
    const scale = targetWidth / baseVp.width;
    const viewport = page.getViewport({ scale });
    const cw = Math.max(1, Math.floor(viewport.width));
    const ch = Math.max(1, Math.floor(viewport.height));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get canvas context");
    }

    const renderTask = page.render({
      canvas,
      canvasContext: ctx,
      viewport
    });
    await renderTask.promise;

    const sx = Math.floor((rx / 100) * cw);
    const sy = Math.floor((ry / 100) * ch);
    const sw = Math.max(1, Math.floor((rw / 100) * cw));
    const sh = Math.max(1, Math.floor((rh / 100) * ch));

    const sx2 = Math.max(0, Math.min(sx, cw - 1));
    const sy2 = Math.max(0, Math.min(sy, ch - 1));
    const sw2 = Math.max(1, Math.min(sw, cw - sx2));
    const sh2 = Math.max(1, Math.min(sh, ch - sy2));

    const crop = document.createElement("canvas");
    crop.width = sw2;
    crop.height = sh2;
    const cctx = crop.getContext("2d");
    if (!cctx) {
      throw new Error("Could not get crop canvas context");
    }
    cctx.drawImage(canvas, sx2, sy2, sw2, sh2, 0, 0, sw2, sh2);

    return await new Promise<Blob>((resolve, reject) => {
      crop.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob failed"));
      }, "image/png");
    });
  } finally {
    await pdf.destroy();
  }
}
