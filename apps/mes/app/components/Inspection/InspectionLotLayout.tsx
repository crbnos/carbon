// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { InspectionParameter, JSONContent } from "@carbon/react";
import {
  Badge,
  ClientOnly,
  cn,
  IconButton,
  SidebarTrigger,
  Spinner,
  useMode,
  usePaneResize,
  useViewport
} from "@carbon/react";
import { round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuEye, LuEyeOff } from "react-icons/lu";
import { useUser } from "~/hooks";
import type {
  InspectionGauge,
  InspectionMeasurement,
  InspectionSample,
  InspectionSamplingPlan
} from "~/services/types";
import InspectionMeasurementMatrix from "./InspectionMeasurementMatrix";
import type {
  InspectionLot,
  InspectionLotState
} from "./useInspectionLotState";

const InspectionDrawingPane = lazy(() => import("./InspectionDrawingPane"));
const ModelUploadPreview = lazy(
  () => import("@carbon/viewer/model-upload-preview")
);

/**
 * The desktop header of a lot view: the sidebar trigger, the company logo and
 * the lot's number, status, item and `detail` (an operation, a work center).
 * `children` are the view's own actions, at the right. Phones use the app bar.
 */
export function InspectionLotHeader({
  inspection,
  lot,
  itemLabel,
  detail,
  badge,
  children
}: {
  inspection: InspectionLot;
  lot: InspectionLotState;
  itemLabel: string | null | undefined;
  detail?: string | null;
  /** Marks the operation itself, e.g. a rework or correction. */
  badge?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const user = useUser();
  const mode = useMode();
  if (isPhone) return null;

  const companyLogo =
    mode === "dark" ? user.company.logoDarkIcon : user.company.logoLightIcon;
  const companyName = user.company.name;

  return (
    <header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border max-md:hidden">
      <SidebarTrigger className="h-full w-auto shrink-0 rounded-none border-r border-border px-2 hover:bg-accent md:px-4" />
      {companyLogo ? (
        <div className="hidden h-full shrink-0 items-center border-r border-border px-4 sm:flex">
          <img
            src={companyLogo}
            alt={t`${companyName} logo`}
            className="h-7 w-auto max-w-[140px] object-contain"
          />
        </div>
      ) : null}

      <div className="flex h-full min-w-0 items-center gap-2 border-r border-border px-3 md:px-5">
        {/* The lot number and status never give way to the actions. */}
        <h1 className="shrink-0 text-sm font-semibold">
          {inspection.inspectionId}
        </h1>
        <Badge variant={lot.statusVariant} className="shrink-0 max-lg:hidden">
          {lot.statusLabel}
        </Badge>
        <span className="hidden text-muted-foreground xl:inline">·</span>
        <span className="hidden truncate text-sm text-foreground/90 xl:inline">
          {itemLabel}
        </span>
        {detail ? (
          <>
            <span className="hidden text-muted-foreground xl:inline">·</span>
            <span className="hidden truncate text-sm text-foreground/90 xl:inline">
              {detail}
            </span>
          </>
        ) : null}
        {badge}
      </div>

      <div className="flex-1" />

      {children}
    </header>
  );
}

/**
 * The lot's sampling line under the header: status (where the header hides
 * it), inspected / sample size, Ac / Re, the plan and the lot size.
 * `badges` go after the status; `children` after the plan's name.
 */
export function InspectionLotMetaBar({
  inspection,
  lot,
  documentName,
  badges,
  children
}: {
  inspection: InspectionLot;
  lot: InspectionLotState;
  documentName: string | null;
  badges?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 overflow-x-auto bg-card border-b border-border px-5 scrollbar-hide max-md:h-auto max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1 max-md:px-4 max-md:py-1.5">
      <Badge variant={lot.statusVariant} className="shrink-0 lg:hidden">
        {lot.statusLabel}
      </Badge>
      {badges}
      <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
        {lot.inspected} / {inspection.sampleSize} <Trans>inspected</Trans> ·{" "}
        <Trans>Ac</Trans> {inspection.acceptanceNumber} · <Trans>Re</Trans>{" "}
        {inspection.rejectionNumber}
        {inspection.codeLetter ? ` · ${inspection.codeLetter}` : ""}
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {lot.planSummary}
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
        <Trans>Lot</Trans> {inspection.lotSize}
      </span>
      {documentName ? (
        <span className="truncate text-xs text-muted-foreground max-md:max-w-full">
          {documentName}
        </span>
      ) : null}
      {children}
    </div>
  );
}

// The drawing pane keeps a pinned height while the matrix is expanded; a
// draggable splitter trades space between them (the ERP InspectionView's
// layout).
const STACK_SPLITTER_H = 8;
const MIN_PDF_PANE_PX = 160;

/** While the matrix is expanded it keeps at least half the stack. */
function clampPdfPaneHeight(
  pdfPx: number,
  stackH: number,
  gridExpanded: boolean
): number {
  if (!gridExpanded || stackH <= STACK_SPLITTER_H + MIN_PDF_PANE_PX) {
    return Math.max(MIN_PDF_PANE_PX, pdfPx);
  }
  const minGrid = stackH * 0.5;
  const maxPdf = Math.max(MIN_PDF_PANE_PX, stackH - STACK_SPLITTER_H - minGrid);
  return Math.min(maxPdf, Math.max(MIN_PDF_PANE_PX, pdfPx));
}

/**
 * The meta bar and the body of a lot view: the drawing (a PDF with balloons,
 * or the model of a PMI plan) over the measurement matrix, or the matrix
 * alone. On phones both scroll with the page.
 */
export function InspectionLotBody({
  inspection,
  lot,
  metaBar,
  isSerial,
  features,
  samples,
  measurements,
  gauges,
  recentGaugeIds,
  parameters,
  workInstruction,
  pdfUrl,
  model
}: {
  inspection: InspectionLot;
  lot: InspectionLotState;
  metaBar: ReactNode;
  isSerial: boolean;
  features: InspectionSamplingPlan[];
  samples: InspectionSample[];
  measurements: InspectionMeasurement[];
  gauges: InspectionGauge[];
  recentGaugeIds: string[];
  parameters: InspectionParameter[];
  workInstruction: JSONContent | null;
  pdfUrl: string | null;
  model: { modelUploadId: string; modelPath: string | null } | null;
}) {
  const { t } = useLingui();
  const user = useUser();
  const { showDrawing, hasDrawing, gridBusy, toggleDrawing } = lot;

  const [gridExpanded, setGridExpanded] = useState(true);
  const [pdfPaneHeightPx, setPdfPaneHeightPx] = useState(360);
  const [stackHeightPx, setStackHeightPx] = useState(0);
  // Until the user drags the splitter, the drawing takes ~45% of the measured
  // stack (capped by the matrix's half-stack minimum).
  const hasUserResizedRef = useRef(false);
  const stackRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: showDrawing re-attaches the observer when hiding and showing the drawing replaces the stack element.
  useEffect(() => {
    if (!stackRef.current) return;
    const el = stackRef.current;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      setStackHeightPx(h);
      setPdfPaneHeightPx((prev) =>
        clampPdfPaneHeight(
          hasUserResizedRef.current ? prev : h * 0.45,
          h,
          gridExpanded
        )
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridExpanded, showDrawing]);

  const splitResize = usePaneResize({
    height: pdfPaneHeightPx,
    clamp: (height) => clampPdfPaneHeight(height, stackHeightPx, gridExpanded),
    enabled: gridExpanded && stackHeightPx > 0,
    onStart: () => {
      hasUserResizedRef.current = true;
    },
    onCommit: setPdfPaneHeightPx
  });

  const matrix = (toolbarActions?: ReactNode) => (
    <InspectionMeasurementMatrix
      parameters={inspection.inspectionDocumentId ? parameters : undefined}
      workInstruction={workInstruction}
      inspectionId={inspection.id}
      isReadOnly={lot.isLocked}
      isSerial={isSerial}
      features={features}
      samples={samples}
      measurements={measurements}
      gauges={gauges}
      recentGaugeIds={recentGaugeIds}
      maxSampleSize={lot.maxSampleSize}
      lotSize={inspection.lotSize}
      lotAcceptanceNumber={inspection.acceptanceNumber}
      lotRejectionNumber={inspection.rejectionNumber}
      activeFeatureId={lot.activeFeatureId}
      onActiveFeatureChange={lot.setActiveFeatureId}
      onMeasurementSaved={lot.onMeasurementSaved}
      placementRef={lot.placementRef}
      onBusyChange={lot.setGridBusy}
      toolbarActions={toolbarActions}
    />
  );

  const spinner = (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );

  return (
    // Phones: the meta bar scrolls away with the body.
    <div className="contents max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:overflow-y-auto">
      {metaBar}

      {showDrawing ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2">
          <div
            ref={stackRef}
            className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
          >
            {/* The drawing — pinned height while the matrix is expanded */}
            <div
              ref={splitResize.paneRef}
              className={cn(
                "flex min-h-0 min-w-full flex-col overflow-hidden rounded-lg border bg-muted",
                gridExpanded ? "shrink-0" : "min-h-[220px] flex-1"
              )}
              style={{
                ...(gridExpanded ? { height: pdfPaneHeightPx } : undefined),
                minWidth: "100%"
              }}
            >
              <ClientOnly fallback={spinner}>
                {() => (
                  <Suspense fallback={spinner}>
                    {model ? (
                      <ModelUploadPreview
                        modelUploadId={model.modelUploadId}
                        modelPath={model.modelPath}
                        companyId={user.company.id}
                        pmiLinks={lot.pmiLinks}
                        selectedLinkId={lot.activeFeatureId}
                        onLinkSelect={lot.setActiveFeatureId}
                        className="h-full rounded-none"
                      />
                    ) : (
                      <InspectionDrawingPane
                        pdfUrl={pdfUrl!}
                        balloons={lot.drawingBalloons}
                        activeFeatureId={lot.activeFeatureId}
                        onBalloonClick={lot.setActiveFeatureId}
                      />
                    )}
                  </Suspense>
                )}
              </ClientOnly>
            </div>

            {gridExpanded ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t`Drag to resize drawing and characteristics`}
                aria-valuenow={round(pdfPaneHeightPx, 0)}
                className={cn(
                  "group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center rounded-md px-2 hover:bg-muted/80 pointer-coarse:h-6 pointer-coarse:hit-area",
                  splitResize.isResizing && "bg-muted"
                )}
                {...splitResize.handleProps}
              >
                <span className="h-1 w-14 shrink-0 rounded-full bg-muted-foreground/40 group-hover:bg-muted-foreground/65" />
              </div>
            ) : null}

            {/* The matrix — collapsible bottom panel */}
            <div
              className={cn(
                "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card",
                gridExpanded ? "min-h-0 flex-1" : "max-h-[14rem] shrink-0"
              )}
              style={
                gridExpanded && stackHeightPx > 0
                  ? { minHeight: stackHeightPx * 0.5 }
                  : undefined
              }
            >
              {matrix(
                <>
                  <IconButton
                    type="button"
                    variant="ghost"
                    aria-label={t`Hide drawing`}
                    title={t`Hide drawing`}
                    icon={<LuEyeOff className="h-4 w-4" />}
                    isDisabled={gridBusy}
                    onClick={toggleDrawing}
                  />
                  <IconButton
                    type="button"
                    variant="ghost"
                    aria-expanded={gridExpanded}
                    aria-label={
                      gridExpanded
                        ? t`Collapse characteristics table`
                        : t`Expand characteristics table`
                    }
                    icon={
                      gridExpanded ? (
                        <LuChevronDown className="h-4 w-4" />
                      ) : (
                        <LuChevronUp className="h-4 w-4" />
                      )
                    }
                    onClick={() => setGridExpanded((v) => !v)}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        // No drawing: the matrix runs edge to edge, no inset card.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:flex-none max-md:overflow-visible">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card max-md:flex-initial">
            {matrix(
              hasDrawing ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  aria-label={t`Show drawing`}
                  title={t`Show drawing`}
                  icon={<LuEye className="h-4 w-4" />}
                  isDisabled={gridBusy}
                  onClick={toggleDrawing}
                />
              ) : undefined
            )}
          </div>
        </div>
      )}
    </div>
  );
}
