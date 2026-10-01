// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Off-screen PDF rasterizing for the inspection plan editor: the padded crop
// of an anchor sent to vision analysis, and the drawing exported with its
// balloons and anchors burned in (matching the Konva overlay). Browser-only:
// it renders through pdf.js onto canvases.
import { closePdf, openPdf } from "@carbon/files/pdf";
import {
  BALLOON_CALLOUT_STROKE,
  clippedBalloonToAnchorLine
} from "@carbon/utils";
import { PDFDocument } from "pdf-lib";

// ─── Anchor crop (vision analysis) ───────────────────────────────────────────

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

type InspectionAnchorCropArgs = {
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

  const pdf = await openPdf(pdfBytes);

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
    await closePdf(pdf);
  }
}

// ─── PDF export with balloon overlays ────────────────────────────────────────

type ExportFeatureRow = {
  balloonId: string;
  balloonAnchorId: string;
  label: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ExportSelectorRect = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function drawMarkupOnPageCanvas(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  pageNumber: number,
  featureRows: ExportFeatureRow[],
  anchorRects: ExportSelectorRect[]
) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const s of anchorRects) {
    if (s.pageNumber !== pageNumber) continue;
    const sx = (s.x / 100) * cw;
    const sy = (s.y / 100) * ch;
    const sw = (s.width / 100) * cw;
    const sh = (s.height / 100) * ch;
    ctx.strokeStyle = BALLOON_CALLOUT_STROKE;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, sw, sh);
  }

  for (const b of featureRows) {
    if (b.pageNumber !== pageNumber) continue;
    const bw = (b.width / 100) * cw;
    const bh = (b.height / 100) * ch;
    const balloonX = (b.x / 100) * cw;
    const balloonY = (b.y / 100) * ch;
    const balloonCenterX = balloonX + bw / 2;
    const balloonCenterY = balloonY + bh / 2;
    const radius = Math.max(8, Math.min(bw, bh) / 2);
    const balloonLabelFontSize = Math.max(
      14,
      Math.min(26, Math.round(radius * 1.15))
    );

    const linkedSelector = anchorRects.find((s) => s.id === b.balloonAnchorId);
    let linePoints: [number, number, number, number] | null = null;
    if (linkedSelector) {
      const sx = (linkedSelector.x / 100) * cw;
      const sy = (linkedSelector.y / 100) * ch;
      const sw = (linkedSelector.width / 100) * cw;
      const sh = (linkedSelector.height / 100) * ch;
      const anchorX = sx + sw / 2;
      const anchorY = sy + sh / 2;
      linePoints = clippedBalloonToAnchorLine(
        balloonCenterX,
        balloonCenterY,
        radius,
        anchorX,
        anchorY,
        { x: sx, y: sy, w: sw, h: sh }
      );
    }

    if (linePoints) {
      ctx.beginPath();
      ctx.strokeStyle = BALLOON_CALLOUT_STROKE;
      ctx.lineWidth = 2;
      ctx.moveTo(linePoints[0], linePoints[1]);
      ctx.lineTo(linePoints[2], linePoints[3]);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(balloonCenterX, balloonCenterY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = BALLOON_CALLOUT_STROKE;
    ctx.lineWidth = 2;
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.stroke();

    ctx.font = `bold ${balloonLabelFontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = BALLOON_CALLOUT_STROKE;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.label, balloonCenterX, balloonCenterY);
  }

  ctx.restore();
}

/**
 * Rasterizes each PDF page with anchor + balloon markup (matching the Konva overlay) and builds a new PDF.
 */
export async function buildInspectionDocumentPdfWithOverlaysBytes(args: {
  pdfBytes: ArrayBuffer;
  featureRows: ExportFeatureRow[];
  anchorRects: ExportSelectorRect[];
  /** PDF.js render scale; higher = sharper file */
  scale?: number;
}): Promise<Uint8Array> {
  const scale = args.scale ?? 2;
  const pdf = await openPdf(args.pdfBytes);
  const outDoc = await PDFDocument.create();

  try {
    const numPages = pdf.numPages;
    for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const cw = Math.floor(viewport.width);
      const ch = Math.floor(viewport.height);
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

      drawMarkupOnPageCanvas(
        ctx,
        cw,
        ch,
        pageNum,
        args.featureRows,
        args.anchorRects
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Canvas toBlob failed"));
        }, "image/png");
      });
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const image = await outDoc.embedPng(pngBytes);
      const pdfPage = outDoc.addPage([cw, ch]);
      pdfPage.drawImage(image, {
        x: 0,
        y: 0,
        width: cw,
        height: ch
      });
    }

    return await outDoc.save({ useObjectStreams: true });
  } finally {
    await closePdf(pdf);
  }
}
