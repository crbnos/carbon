import { IconButton } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { Circle, Group, Layer, Stage, Text } from "react-konva";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

const CALLOUT_STROKE = "#f97316";

export type DrawingBalloon = {
  id: string;
  inspectionFeatureId: string;
  pageNumber: number;
  xCoordinate: number;
  yCoordinate: number;
  label: string;
};

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
                    // DB coordinates are normalized 0–1.
                    const x = balloon.xCoordinate * containerWidth;
                    const y = balloon.yCoordinate * overlayHeight;
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
