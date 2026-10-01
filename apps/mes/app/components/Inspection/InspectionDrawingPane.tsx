import { IconButton } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { Circle, Group, Layer, Line, Stage, Text } from "react-konva";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

const CALLOUT_STROKE = "#f97316";

// A balloon is stored as the top-left corner of a box this size (normalized to
// the page); the circle sits at the box's center. The plan editor places
// balloons with the same box, so both views agree on where a circle is.
export const BALLOON_W_NORM = 0.04;
export const BALLOON_H_NORM = 0.04;

export type DrawingBalloon = {
  id: string;
  inspectionFeatureId: string;
  pageNumber: number;
  xCoordinate: number;
  yCoordinate: number;
  regionX: number;
  regionY: number;
  regionWidth: number;
  regionHeight: number;
  label: string;
};

/** Liang–Barsky: clip segment (x0,y0)→(x1,y1) to axis-aligned rect; returns [0,1] params or null. */
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

/**
 * Visible connector from balloon edge → toward anchor, stopping before the anchor rect interior.
 * u is linear param from B (0) to A (1); balloon occupies u ∈ [0, r/L).
 */
export function clippedBalloonToAnchorLine(
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

type InspectionDrawingPaneProps = {
  pdfUrl: string;
  balloons: DrawingBalloon[];
  activeFeatureId: string | null;
  onBalloonClick: (inspectionFeatureId: string) => void;
};

// Read-only PDF + balloon viewer for the inbound inspection execution screen.
// A stripped-down sibling of InspectionDocumentEditor's viewer: no ballooning,
// no zoom box — fit-to-width with page navigation and clickable balloons.
// The pdf.js worker is configured globally in entry.client.tsx. This module
// must be imported lazily (ClientOnly) — react-pdf and react-konva are
// client-only.
const InspectionDrawingPane = ({
  pdfUrl,
  balloons,
  activeFeatureId,
  onBalloonClick
}: InspectionDrawingPaneProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [overlayHeight, setOverlayHeight] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageRendered, setPageRendered] = useState(false);

  // Fit-to-width: track the container so the Page re-renders on pane resize.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // The Konva overlay matches the rendered page's real height.
  useEffect(() => {
    if (!pageWrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0;
      if (height > 0) setOverlayHeight(height);
    });
    ro.observe(pageWrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Balloon click in the grid direction: jump to the active feature's page.
  useEffect(() => {
    if (!activeFeatureId) return;
    const balloon = balloons.find(
      (b) => b.inspectionFeatureId === activeFeatureId
    );
    if (balloon && balloon.pageNumber !== page) {
      setPage(balloon.pageNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFeatureId]);

  const pageBalloons = useMemo(
    () => balloons.filter((b) => b.pageNumber === page),
    [balloons, page]
  );

  const balloonRadius = Math.max(10, containerWidth * 0.012);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {numPages > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-b border-border bg-card px-3 py-2.5 shadow-sm">
          <IconButton
            type="button"
            aria-label="Previous page"
            variant="secondary"
            size="sm"
            icon={<LuChevronLeft className="h-4 w-4" />}
            isDisabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          />
          <span className="min-w-[8.5rem] select-none text-center text-sm font-medium tabular-nums text-foreground">
            Page {page} of {numPages}
          </span>
          <IconButton
            type="button"
            aria-label="Next page"
            variant="secondary"
            size="sm"
            icon={<LuChevronRight className="h-4 w-4" />}
            isDisabled={page >= numPages}
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
          />
        </div>
      )}
      <div ref={containerRef} className="relative flex-1 overflow-auto">
        <div
          className="relative select-none"
          style={{ width: containerWidth > 0 ? containerWidth : "100%" }}
        >
          <div ref={pageWrapperRef} className="pointer-events-none">
            <Document
              file={pdfUrl}
              onLoadSuccess={(pdf) => {
                setNumPages(pdf.numPages);
                setPage(1);
              }}
            >
              {containerWidth > 0 ? (
                <Page
                  key={page}
                  pageNumber={page}
                  width={containerWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  className="w-full"
                  onRenderSuccess={() => setPageRendered(true)}
                />
              ) : null}
            </Document>
          </div>

          {pageRendered && containerWidth > 0 && overlayHeight > 0 && (
            <div className="pointer-events-auto absolute inset-0 z-[9]">
              <Stage width={containerWidth} height={overlayHeight} listening>
                <Layer>
                  {pageBalloons.map((balloon) => {
                    // DB coordinates are normalized 0–1: the balloon box's
                    // top-left corner, and the anchor region it points at.
                    const x =
                      (balloon.xCoordinate + BALLOON_W_NORM / 2) *
                      containerWidth;
                    const y =
                      (balloon.yCoordinate + BALLOON_H_NORM / 2) *
                      overlayHeight;
                    const region = {
                      x: balloon.regionX * containerWidth,
                      y: balloon.regionY * overlayHeight,
                      w: balloon.regionWidth * containerWidth,
                      h: balloon.regionHeight * overlayHeight
                    };
                    const linePoints = clippedBalloonToAnchorLine(
                      x,
                      y,
                      balloonRadius,
                      region.x + region.w / 2,
                      region.y + region.h / 2,
                      region
                    );
                    const isActive =
                      balloon.inspectionFeatureId === activeFeatureId;
                    return (
                      <Group
                        key={balloon.id}
                        onClick={() =>
                          onBalloonClick(balloon.inspectionFeatureId)
                        }
                        onTap={() =>
                          onBalloonClick(balloon.inspectionFeatureId)
                        }
                        onMouseEnter={(e) => {
                          const stage = e.target.getStage();
                          if (stage) stage.container().style.cursor = "pointer";
                        }}
                        onMouseLeave={(e) => {
                          const stage = e.target.getStage();
                          if (stage) stage.container().style.cursor = "";
                        }}
                      >
                        {linePoints && (
                          <Line
                            points={linePoints}
                            stroke={CALLOUT_STROKE}
                            strokeWidth={2}
                            listening={false}
                          />
                        )}
                        <Circle
                          x={x}
                          y={y}
                          radius={balloonRadius}
                          stroke={CALLOUT_STROKE}
                          strokeWidth={isActive ? 3 : 2}
                          fill={
                            isActive
                              ? "rgba(249,115,22,0.25)"
                              : "rgba(255,255,255,0.75)"
                          }
                        />
                        <Text
                          x={x - balloonRadius}
                          y={y - balloonRadius * 0.55}
                          width={balloonRadius * 2}
                          align="center"
                          text={balloon.label}
                          fontSize={balloonRadius}
                          fontStyle="bold"
                          fill={CALLOUT_STROKE}
                          listening={false}
                        />
                      </Group>
                    );
                  })}
                </Layer>
              </Stage>
            </div>
          )}
        </div>
      </div>
      {pdfUrl === "" && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No drawing available
        </div>
      )}
    </div>
  );
};

export default InspectionDrawingPane;
