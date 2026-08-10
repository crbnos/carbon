import { PDFDocument } from "pdf-lib";
import { pdfjs } from "react-pdf";

const CALLOUT_STROKE = "#f97316";

function liangBarskySegmentRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { u0: number; u1: number } | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let u0 = 0;
  let u1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        u0 = Math.max(u0, r);
      } else {
        u1 = Math.min(u1, r);
      }
      if (u0 > u1) return null;
    }
  }
  return { u0, u1 };
}

function clippedBalloonToAnchorLine(
  bx: number,
  by: number,
  radiusPx: number,
  ax: number,
  ay: number,
  rect: { x: number; y: number; w: number; h: number }
): [number, number, number, number] | null {
  const L = Math.hypot(ax - bx, ay - by);
  if (L < 1e-6) return null;
  const epsU = Math.max(1e-4, 2 / L);
  const uBalloonExit = Math.min(1 - epsU, radiusPx / L + epsU);
  const { x, y, w, h } = rect;
  const hit = liangBarskySegmentRect(bx, by, ax, ay, x, y, x + w, y + h);
  let uEnd = 1 - epsU;
  if (hit) {
    const uEnter = Math.max(0, Math.min(1, hit.u0));
    if (uEnter > uBalloonExit) {
      uEnd = Math.min(uEnd, uEnter - epsU);
    }
  }
  if (uEnd <= uBalloonExit + 1e-4) return null;
  const x0 = bx + (ax - bx) * uBalloonExit;
  const y0 = by + (ay - by) * uBalloonExit;
  const x1 = bx + (ax - bx) * uEnd;
  const y1 = by + (ay - by) * uEnd;
  return [x0, y0, x1, y1];
}

export type ExportFeatureRow = {
  balloonId: string;
  balloonAnchorId: string;
  label: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExportSelectorRect = {
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
    ctx.strokeStyle = CALLOUT_STROKE;
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
      ctx.strokeStyle = CALLOUT_STROKE;
      ctx.lineWidth = 2;
      ctx.moveTo(linePoints[0], linePoints[1]);
      ctx.lineTo(linePoints[2], linePoints[3]);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(balloonCenterX, balloonCenterY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = CALLOUT_STROKE;
    ctx.lineWidth = 2;
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.stroke();

    ctx.font = `bold ${balloonLabelFontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = CALLOUT_STROKE;
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
  const data = new Uint8Array(args.pdfBytes);
  const pdf = await pdfjs.getDocument({ data }).promise;
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
    await pdf.destroy();
  }
}
