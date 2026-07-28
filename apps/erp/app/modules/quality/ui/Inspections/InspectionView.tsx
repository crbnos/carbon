import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  ClientOnly,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuChevronDown,
  LuChevronUp,
  LuFileText,
  LuScan,
  LuShieldAlert,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type {
  InspectionMeasurement,
  InspectionRow,
  InspectionSample,
  InspectionSamplingPlan,
  InspectionTrackedEntity,
  IssueTypeListItem
} from "~/modules/quality/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { getReadableIdWithRevision } from "~/utils/string";
import type { DrawingBalloon } from "./InspectionDrawingPane";
import type { MeasurementSaveResult } from "./InspectionMeasurementGrid";
import InspectionMeasurementGrid from "./InspectionMeasurementGrid";
import type { FailedFeatureSummary } from "./RejectLotModal";
import RejectLotModal from "./RejectLotModal";
import ScanInspectionSample from "./ScanInspectionSample";

const InspectionDrawingPane = lazy(() => import("./InspectionDrawingPane"));

// Vertical-stack sizing, mirrored from InspectionDocumentEditor: the PDF pane
// keeps a pinned height while the features grid is expanded; a draggable
// splitter trades space between them.
const STACK_SPLITTER_H = 8;
const MIN_PDF_PANE_PX = 160;

/** When the grid is expanded it keeps at least half the stack; PDF height is capped accordingly. */
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

export type InspectionViewProps = {
  inspection: InspectionRow;
  sourceDocumentReadableId: string | null;
  receiverId: string | null;
  itemName: string;
  itemTrackingType: string | null;
  supplierName: string | null;
  samples: InspectionSample[];
  features: InspectionSamplingPlan[];
  measurements: InspectionMeasurement[];
  balloons: {
    id: string;
    inspectionFeatureId: string;
    pageNumber: number;
    xCoordinate: number;
    yCoordinate: number;
  }[];
  documentName: string | null;
  pdfUrl: string | null;
  lotEntities: InspectionTrackedEntity[];
  issueTypes: IssueTypeListItem[];
  currentUserId: string;
  enforceFourEyes: boolean;
};

// Full-screen inbound inspection execution view. One UI for every lot: the
// measurement grid, with a ballooned drawing above it when the lot has a PDF and
// a single "Overall result" pass/fail row when the document resolved no
// features. Serial lots build their sample columns by scanning tracked entities.
// Reusable as a data-prop component (AssemblyView pattern) so MES can consume it.
const InspectionView = ({
  inspection,
  sourceDocumentReadableId,
  receiverId,
  itemName,
  itemTrackingType,
  supplierName,
  samples,
  features,
  measurements,
  balloons,
  documentName,
  pdfUrl,
  lotEntities,
  issueTypes,
  currentUserId,
  enforceFourEyes
}: InspectionViewProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "quality");
  const [items] = useItems();

  const isSerial = itemTrackingType === "Serial";
  // Accept/Reject dispositions here carry no physical production posting, so they
  // are Receipt-only. Job Operation lots are verdict-only in the ERP — their
  // complete/scrap/rework outcome is orchestrated by the MES disposition route
  // (which closes the lot one-shot). Exposing Accept/Reject on a job-op lot would
  // hard-terminate it with no posting and wedge the operation.
  const isReceiptSource = inspection.sourceDocument === "Receipt";
  const liveFeatures = useMemo(
    () => features.filter((f) => f.inspectionFeature != null),
    [features]
  );
  // The measurement grid is the single execution UI. A drawing pane shows when
  // the lot has an assigned PDF; per-feature feature rows show when the
  // document resolved features, otherwise the grid collapses to one pass/fail
  // "Overall result" row.
  const showDrawing = pdfUrl != null;
  const hasFeatures = liveFeatures.length > 0;

  const scannerDisclosure = useDisclosure();
  const rejectConfirmDisclosure = useDisclosure();
  const acceptConfirmDisclosure = useDisclosure();
  const documentSwitchDisclosure = useDisclosure();

  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);

  // PDF-over-grid stack (InspectionDocumentEditor's layout model).
  const [gridExpanded, setGridExpanded] = useState(true);
  const [pdfPaneHeightPx, setPdfPaneHeightPx] = useState(360);
  const [stackHeightPx, setStackHeightPx] = useState(0);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitDragRef = useRef<{ startY: number; startPdfPx: number } | null>(
    null
  );
  // Until the user drags the splitter, the PDF takes ~45% of the measured
  // stack (capped by the grid's half-stack minimum) instead of a fixed pixel
  // default — portrait drawings get a usable slice on tall viewports.
  const hasUserResizedRef = useRef(false);
  const stackRef = useRef<HTMLDivElement>(null);

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
  }, [gridExpanded]);

  useEffect(() => {
    if (!isResizingSplit) return;
    const onMove = (e: MouseEvent) => {
      const start = splitDragRef.current;
      if (!start) return;
      const dy = e.clientY - start.startY;
      setPdfPaneHeightPx(
        clampPdfPaneHeight(start.startPdfPx + dy, stackHeightPx, gridExpanded)
      );
    };
    const onUp = () => {
      setIsResizingSplit(false);
      splitDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizingSplit, stackHeightPx, gridExpanded]);

  const onSplitResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!gridExpanded) return;
      e.preventDefault();
      hasUserResizedRef.current = true;
      splitDragRef.current = {
        startY: e.clientY,
        startPdfPx: pdfPaneHeightPx
      };
      setIsResizingSplit(true);
    },
    [gridExpanded, pdfPaneHeightPx]
  );

  // Per-cell saves are quiet (no revalidation), so measurement + derived
  // sample statuses are mirrored locally from the save responses and merged
  // with the loader data for gating.
  const [measurementOverrides, setMeasurementOverrides] = useState<
    Record<string, "Pending" | "Passed" | "Failed">
  >({});
  const [sampleStatusOverrides, setSampleStatusOverrides] = useState<
    Record<string, "Pending" | "Passed" | "Failed">
  >({});
  const [measurementValueOverrides, setMeasurementValueOverrides] = useState<
    Record<string, number | null>
  >({});
  const onMeasurementSaved = useCallback((result: MeasurementSaveResult) => {
    const key = `${result.sampleId}:${result.inspectionFeatureId}`;
    setMeasurementOverrides((prev) => ({
      ...prev,
      [key]: result.measurementStatus
    }));
    setMeasurementValueOverrides((prev) => ({ ...prev, [key]: result.value }));
    setSampleStatusOverrides((prev) => ({
      ...prev,
      [result.sampleId]: result.sampleStatus
    }));
  }, []);

  // Effective measurement statuses: loader data + local overrides (new cells
  // exist only in overrides).
  const effectiveMeasurements = useMemo(() => {
    const byKey = new Map<
      string,
      { featureId: string; status: string; value: number | null }
    >();
    for (const m of measurements) {
      byKey.set(`${m.inspectionSampleId}:${m.inspectionFeatureId}`, {
        featureId: m.inspectionFeatureId,
        status: m.status,
        value: m.value == null ? null : Number(m.value)
      });
    }
    for (const [key, status] of Object.entries(measurementOverrides)) {
      const featureId = key.split(":")[1] ?? "";
      byKey.set(key, {
        featureId,
        status,
        value: measurementValueOverrides[key] ?? null
      });
    }
    return byKey;
  }, [measurements, measurementOverrides, measurementValueOverrides]);

  const featureCounts = useMemo(() => {
    const counts = new Map<string, { recorded: number; failed: number }>();
    for (const feature of liveFeatures) {
      counts.set(feature.inspectionFeatureId, { recorded: 0, failed: 0 });
    }
    for (const measurement of effectiveMeasurements.values()) {
      const entry = counts.get(measurement.featureId);
      if (!entry) continue;
      if (measurement.status !== "Pending") entry.recorded += 1;
      if (measurement.status === "Failed") entry.failed += 1;
    }
    return counts;
  }, [liveFeatures, effectiveMeasurements]);

  // Effective sample statuses: loader samples + derived-status overrides +
  // anonymous samples created during this session (only in overrides).
  const sampleStatuses = useMemo(() => {
    const statuses = new Map<string, string>();
    for (const sample of samples) {
      statuses.set(sample.id, sample.status);
    }
    for (const [sampleId, status] of Object.entries(sampleStatusOverrides)) {
      statuses.set(sampleId, status);
    }
    return statuses;
  }, [samples, sampleStatusOverrides]);

  const passes = [...sampleStatuses.values()].filter(
    (s) => s === "Passed"
  ).length;
  const fails = [...sampleStatuses.values()].filter(
    (s) => s === "Failed"
  ).length;
  const inspected = passes + fails;

  const sampledIds = useMemo(
    () => new Set(samples.map((s) => s.trackedEntityId)),
    [samples]
  );
  const remaining = lotEntities.filter((e) => !sampledIds.has(e.id));

  // Item display id from the live items store (snapshot may be stale).
  const item = items.find((i) => i.id === inspection.itemId);
  const [storeReadableId, storeRevision] = (() => {
    const combined = (item as any)?.readableIdWithRevision as
      | string
      | undefined;
    if (!combined) return [undefined, undefined] as const;
    const dot = combined.lastIndexOf(".");
    if (dot < 0) return [combined, undefined] as const;
    return [combined.slice(0, dot), combined.slice(dot + 1)] as const;
  })();
  const displayReadableId =
    storeReadableId != null
      ? getReadableIdWithRevision(storeReadableId, storeRevision)
      : (inspection.itemReadableId ?? "");
  const displayItemName = item?.name ?? itemName;

  const showFourEyesWarning =
    enforceFourEyes && !!receiverId && receiverId === currentUserId;

  const lotClosed =
    inspection.dispositionedAt != null &&
    (inspection.status === "Passed" || inspection.status === "Failed");

  // Serial lots build their sample columns by scanning tracked entities. The
  // header "Add Sample" button stays primary until the plan's sample size is
  // covered; a fresh serial lot auto-opens the scanner so the first scan is one
  // tap away.
  const allSamplesLoaded = samples.length >= inspection.sampleSize;
  const hasAutoOpenedScanRef = useRef(false);
  useEffect(() => {
    if (hasAutoOpenedScanRef.current) return;
    if (isSerial && samples.length === 0 && !lotClosed && canUpdate) {
      hasAutoOpenedScanRef.current = true;
      scannerDisclosure.onOpen();
    }
  }, [isSerial, samples.length, lotClosed, canUpdate, scannerDisclosure]);

  const maxSampleSize = hasFeatures
    ? Math.max(1, ...liveFeatures.map((f) => f.sampleSize))
    : inspection.sampleSize;

  // Gating. Feature-driven lots gate per feature (mirrors the
  // server-side disposition guards); lots without features gate at the lot
  // level on the "Overall result" pass/fail counts.
  let canAccept: boolean;
  let canReject: boolean;
  if (hasFeatures) {
    const allFeaturesSatisfied = liveFeatures.every((feature) => {
      const counts = featureCounts.get(feature.inspectionFeatureId) ?? {
        recorded: 0,
        failed: 0
      };
      return (
        counts.recorded >= feature.sampleSize &&
        counts.failed <= feature.acceptanceNumber
      );
    });
    const anyFeatureRejectable = liveFeatures.some((feature) => {
      const counts = featureCounts.get(feature.inspectionFeatureId);
      return counts != null && counts.failed >= feature.rejectionNumber;
    });
    canAccept = isReceiptSource && !lotClosed && allFeaturesSatisfied;
    canReject =
      isReceiptSource && !lotClosed && (anyFeatureRejectable || fails > 0);
  } else {
    canAccept =
      isReceiptSource &&
      !lotClosed &&
      inspected >= inspection.sampleSize &&
      fails <= inspection.acceptanceNumber;
    canReject =
      isReceiptSource && !lotClosed && fails > inspection.acceptanceNumber;
  }

  const failedFeatureSummary = useMemo<FailedFeatureSummary[]>(() => {
    if (!hasFeatures) return [];
    return liveFeatures
      .map((lotFeature) => {
        const feature = lotFeature.inspectionFeature!;
        const failedValues: string[] = [];
        for (const [key, m] of effectiveMeasurements.entries()) {
          if (m.featureId !== feature.id || m.status !== "Failed") continue;
          failedValues.push(m.value == null ? "F" : String(m.value));
          void key;
        }
        if (failedValues.length === 0) return null;
        const spec = [
          feature.nominalValue,
          feature.tolerancePlus != null || feature.toleranceMinus != null
            ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
            : null,
          feature.unit
        ]
          .filter(Boolean)
          .join(" ");
        return { label: feature.label, spec, failedValues };
      })
      .filter(Boolean) as FailedFeatureSummary[];
  }, [hasFeatures, liveFeatures, effectiveMeasurements]);

  const failedTrackedEntityIds = samples
    .filter((s) => (sampleStatuses.get(s.id) ?? s.status) === "Failed")
    .map((s) => s.trackedEntityId)
    .filter(Boolean) as string[];

  const newIssueHref = `/x/issue/new?itemId=${encodeURIComponent(inspection.itemId)}&trackedEntityIds=${encodeURIComponent(failedTrackedEntityIds.join(","))}&sourceInspectionId=${encodeURIComponent(inspection.id)}`;

  const drawingBalloons = useMemo<DrawingBalloon[]>(() => {
    const labelByFeatureId = new Map(
      liveFeatures.map((f) => [
        f.inspectionFeatureId,
        f.inspectionFeature!.label
      ])
    );
    return balloons
      .filter((b) => labelByFeatureId.has(b.inspectionFeatureId))
      .map((b) => ({
        id: b.id,
        inspectionFeatureId: b.inspectionFeatureId,
        pageNumber: b.pageNumber,
        xCoordinate: b.xCoordinate,
        yCoordinate: b.yCoordinate,
        label: labelByFeatureId.get(b.inspectionFeatureId) ?? ""
      }));
  }, [balloons, liveFeatures]);

  const hasMeasurements = effectiveMeasurements.size > 0;

  const statusBadgeVariant =
    inspection.status === "Passed"
      ? ("green" as const)
      : inspection.status === "Failed"
        ? ("red" as const)
        : ("secondary" as const);

  const planSummary =
    inspection.samplingPlanType === "AQL"
      ? `AQL ${inspection.aql ?? ""} · Lvl ${inspection.inspectionLevel ?? ""} · ${inspection.severity ?? ""}`
      : inspection.samplingPlanType;

  const metaLine = [
    `${displayReadableId} · ${displayItemName}`,
    [sourceDocumentReadableId, supplierName].filter(Boolean).join(" — "),
    planSummary,
    `${inspected} / ${inspection.sampleSize} · Ac ${inspection.acceptanceNumber} · Re ${inspection.rejectionNumber}${inspection.codeLetter ? ` · ${inspection.codeLetter}` : ""}`,
    documentName ?? null
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar — mirrors InspectionDocumentEditor's header */}
      <div className="flex min-h-[50px] flex-shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 overflow-x-auto border-b border-border bg-card px-4 py-2 scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <div className="min-w-0 flex-1 pr-2">
          <HStack spacing={2} className="items-center">
            <h1 className="truncate text-base font-semibold">
              {inspection.inspectionId}
            </h1>
            <Badge variant={statusBadgeVariant}>{inspection.status}</Badge>
          </HStack>
          <p className="truncate text-xs text-muted-foreground">{metaLine}</p>
        </div>
        <HStack spacing={2} className="flex-shrink-0 flex-wrap justify-end">
          <Button
            variant="secondary"
            leftIcon={<LuShieldAlert />}
            asChild
            isDisabled={failedTrackedEntityIds.length === 0}
          >
            <a href={newIssueHref} target="_blank" rel="noreferrer">
              <Trans>Create Issue</Trans>
            </a>
          </Button>
          {canUpdate && !lotClosed && !hasMeasurements && (
            <Button
              variant="secondary"
              leftIcon={<LuFileText />}
              onClick={documentSwitchDisclosure.onOpen}
            >
              <Trans>Change Document</Trans>
            </Button>
          )}
          {isSerial && !lotClosed && (
            <Button
              variant={allSamplesLoaded ? "secondary" : "primary"}
              leftIcon={<LuScan />}
              onClick={scannerDisclosure.onOpen}
              isDisabled={!canUpdate}
            >
              <Trans>Add Sample</Trans>
            </Button>
          )}
          {isReceiptSource && (
            <>
              <Button
                variant="destructive"
                onClick={rejectConfirmDisclosure.onOpen}
                isDisabled={!canUpdate || !canReject}
              >
                <Trans>Reject Lot</Trans>
              </Button>
              <Button
                onClick={acceptConfirmDisclosure.onOpen}
                isDisabled={!canUpdate || !canAccept}
              >
                <Trans>Accept Lot</Trans>
              </Button>
            </>
          )}
        </HStack>
      </div>

      {showFourEyesWarning && (
        <div className="shrink-0 px-4 pt-2">
          <Alert variant="warning">
            <LuTriangleAlert className="size-4" />
            <AlertTitle>
              <Trans>You received this lot</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                Company policy asks for a different person to inspect inbound
                items than the one who received them.
              </Trans>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* ── Body ── */}
      {showDrawing ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2">
          <div
            ref={stackRef}
            className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
          >
            {/* PDF viewer — pinned height while the grid is expanded */}
            <div
              className={`flex min-h-0 min-w-full flex-col overflow-hidden rounded-lg border bg-muted ${
                gridExpanded ? "shrink-0" : "min-h-[220px] flex-1"
              }`}
              style={{
                ...(gridExpanded ? { height: pdfPaneHeightPx } : undefined),
                minWidth: "100%"
              }}
            >
              <ClientOnly
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Spinner />
                  </div>
                }
              >
                {() => (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <Spinner />
                      </div>
                    }
                  >
                    <InspectionDrawingPane
                      pdfUrl={pdfUrl!}
                      balloons={drawingBalloons}
                      activeFeatureId={activeFeatureId}
                      onBalloonClick={setActiveFeatureId}
                    />
                  </Suspense>
                )}
              </ClientOnly>
            </div>

            {gridExpanded ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t`Drag to resize drawing and features`}
                aria-valuenow={Math.round(pdfPaneHeightPx)}
                className={`group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center rounded-md px-2 hover:bg-muted/80 ${
                  isResizingSplit ? "bg-muted" : ""
                }`}
                onMouseDown={onSplitResizeMouseDown}
              >
                <span className="h-1 w-14 shrink-0 rounded-full bg-muted-foreground/40 group-hover:bg-muted-foreground/65" />
              </div>
            ) : null}

            {/* Features grid — collapsible bottom panel */}
            <div
              className={
                gridExpanded
                  ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-card"
                  : "flex max-h-[14rem] min-w-0 shrink-0 flex-col overflow-hidden rounded-lg bg-card"
              }
              style={
                gridExpanded && stackHeightPx > 0
                  ? { minHeight: stackHeightPx * 0.5 }
                  : undefined
              }
            >
              <div
                className={
                  gridExpanded
                    ? "min-h-0 flex-1 overflow-auto"
                    : "overflow-hidden"
                }
              >
                <InspectionMeasurementGrid
                  inspectionId={inspection.id}
                  isReadOnly={!canUpdate || lotClosed}
                  isSerial={isSerial}
                  features={features}
                  samples={samples}
                  measurements={measurements}
                  maxSampleSize={maxSampleSize}
                  lotSize={inspection.lotSize}
                  lotAcceptanceNumber={inspection.acceptanceNumber}
                  lotRejectionNumber={inspection.rejectionNumber}
                  activeFeatureId={activeFeatureId}
                  onActiveFeatureChange={setActiveFeatureId}
                  onMeasurementSaved={onMeasurementSaved}
                  primaryAction={
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={gridExpanded}
                      aria-label={
                        gridExpanded
                          ? t`Collapse features table`
                          : t`Expand features table`
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
                  }
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        // No drawing: the grid takes the full body. Feature-driven lots still
        // render their features; lots without a document collapse to the
        // single "Overall result" row inside the same grid.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-card">
            <div className="min-h-0 flex-1 overflow-auto">
              <InspectionMeasurementGrid
                inspectionId={inspection.id}
                isReadOnly={!canUpdate || lotClosed}
                isSerial={isSerial}
                features={features}
                samples={samples}
                measurements={measurements}
                maxSampleSize={maxSampleSize}
                lotSize={inspection.lotSize}
                lotAcceptanceNumber={inspection.acceptanceNumber}
                lotRejectionNumber={inspection.rejectionNumber}
                activeFeatureId={activeFeatureId}
                onActiveFeatureChange={setActiveFeatureId}
                onMeasurementSaved={onMeasurementSaved}
              />
            </div>
          </div>
        </div>
      )}

      {scannerDisclosure.isOpen && (
        <ScanInspectionSample
          inspectionId={inspection.id}
          isSerial={isSerial}
          remaining={remaining}
          inspected={inspected}
          sampleSize={inspection.sampleSize}
          fails={fails}
          acceptanceNumber={inspection.acceptanceNumber}
          onClose={scannerDisclosure.onClose}
        />
      )}

      {acceptConfirmDisclosure.isOpen && (
        <Confirm
          action={path.to.inspectionAccept(inspection.id)}
          title={t`Accept lot?`}
          text={
            isSerial
              ? t`${lotEntities.length - inspected} un-sampled entities will be released to Available. Sampled passes stay Available and sampled failures stay Rejected.`
              : t`The lot will be marked Passed. ${fails} sampled failure(s) are recorded for your records.`
          }
          confirmText={t`Accept Lot`}
          onCancel={acceptConfirmDisclosure.onClose}
          onSubmit={acceptConfirmDisclosure.onClose}
        />
      )}

      {rejectConfirmDisclosure.isOpen && (
        <RejectLotModal
          action={path.to.inspectionReject(inspection.id)}
          issueTypes={issueTypes}
          summary={
            isSerial
              ? t`Statistical acceptance failed, so the entire lot is considered non-conforming (ISO 9001:2015 §8.7). All ${lotEntities.length} entities — ${passes} sampled pass(es), ${fails} failure(s), and ${Math.max(0, lotEntities.length - inspected)} un-inspected — will be marked Rejected.`
              : t`Statistical acceptance failed, so the entire lot of ${inspection.lotSize} is considered non-conforming (ISO 9001:2015 §8.7) — ${passes} sampled pass(es) and ${fails} failure(s).`
          }
          failedFeatureSummary={failedFeatureSummary}
          onCancel={rejectConfirmDisclosure.onClose}
          onSubmit={rejectConfirmDisclosure.onClose}
        />
      )}

      {documentSwitchDisclosure.isOpen && (
        <DocumentSwitchModal
          inspectionId={inspection.id}
          itemId={inspection.itemId}
          currentDocumentId={inspection.inspectionDocumentId ?? null}
          onClose={documentSwitchDisclosure.onClose}
        />
      )}
    </div>
  );
};

// Swap the assigned inspection document on an open, unmeasured lot. Options
// are the item's documents (same source as the Form/InspectionDocument
// combobox's api route).
function DocumentSwitchModal({
  inspectionId,
  itemId,
  currentDocumentId,
  onClose
}: {
  inspectionId: string;
  itemId: string;
  currentDocumentId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const optionsFetcher = useFetcher<{
    data:
      | {
          id: string;
          fileName: string | null;
          drawingNumber: string | null;
          version: number;
        }[]
      | null;
  }>();
  const [documentId, setDocumentId] = useState(currentDocumentId ?? "none");

  useEffect(() => {
    if (optionsFetcher.state === "idle" && optionsFetcher.data == null) {
      optionsFetcher.load(path.to.api.inspectionDocuments(itemId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = optionsFetcher.data?.data ?? [];

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Change Inspection Plan</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={2}>
            <p className="text-sm text-muted-foreground">
              <Trans>
                The lot's per-feature sampling plan will be re-resolved from the
                selected document.
              </Trans>
            </p>
            <Select value={documentId} onValueChange={setDocumentId}>
              <SelectTrigger>
                <SelectValue placeholder={t`Select a document`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t`None`}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {(option.drawingNumber ?? option.fileName ?? option.id) +
                      ` v${option.version}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.inspectionAssignedDocument(inspectionId)}
            onSubmit={onClose}
          >
            <input
              type="hidden"
              name="inspectionDocumentId"
              value={documentId === "none" ? "" : documentId}
            />
            <Button type="submit" isLoading={fetcher.state !== "idle"}>
              <Trans>Save</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default InspectionView;
