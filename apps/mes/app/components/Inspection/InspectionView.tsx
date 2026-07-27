import {
  Badge,
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  Button,
  ClientOnly,
  cn,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  SidebarTrigger,
  Spinner,
  useDisclosure,
  useMode,
  VStack
} from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
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
  LuCheck,
  LuCheckCheck,
  LuChevronDown,
  LuChevronUp,
  LuContrast,
  LuEllipsisVertical,
  LuFlag,
  LuGitPullRequest,
  LuPause,
  LuPlay,
  LuScan,
  LuTrash,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { QualityIssueModal } from "~/components/JobOperation/components/QualityIssueModal";
import { QuantityModal } from "~/components/JobOperation/components/QuantityModal";
import { ReworkModal } from "~/components/JobOperation/components/ReworkModal";
import { useUser } from "~/hooks";
import type {
  InspectionMeasurement,
  Inspection as InspectionRow,
  InspectionSample,
  InspectionSamplingPlan,
  IssueTypeListItem,
  Job,
  OperationWithDetails,
  ProductionEvent,
  TrackedEntity
} from "~/services/types";
import { path } from "~/utils/path";
import type { AllocatableUnit, FailedFeatureSummary } from "./DispositionModal";
import DispositionModal from "./DispositionModal";
import type { MeasurementSaveResult } from "./InspectionMeasurementMatrix";
import InspectionMeasurementMatrix from "./InspectionMeasurementMatrix";
import ScanInspectionSample from "./ScanInspectionSample";

const InspectionDrawingPane = lazy(() => import("./InspectionDrawingPane"));

// Vertical-stack sizing, mirrored from the ERP quality InspectionView: the PDF
// pane keeps a pinned height while the features table is expanded; a draggable
// splitter trades space between them.
const STACK_SPLITTER_H = 8;
const MIN_PDF_PANE_PX = 160;

/** When the table is expanded it keeps at least half the stack; PDF height is capped accordingly. */
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

type DrawingBalloonRow = {
  id: string;
  inspectionFeatureId: string;
  pageNumber: number;
  xCoordinate: number;
  yCoordinate: number;
};

type WorkType = "Setup" | "Labor" | "Machine";

type InspectionViewProps = {
  operationId: string;
  job: Job;
  operation: OperationWithDetails;
  inspection: InspectionRow & {
    item?: {
      readableId: string | null;
      name: string | null;
      type: string | null;
      itemTrackingType: string | null;
    } | null;
  };
  samples: InspectionSample[];
  features: InspectionSamplingPlan[];
  measurements: InspectionMeasurement[];
  balloons: DrawingBalloonRow[];
  documentName: string | null;
  pdfUrl: string | null;
  issueTypes: IssueTypeListItem[];
  trackedEntities: TrackedEntity[];
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
  events: ProductionEvent[];
  productionQuantities: { scrap: number; production: number; rework: number };
  // Verdict-driven postings link back to their sample; the header derives
  // "Complete passed (n)" from what is passed but not yet posted.
  linkedSampleIds: string[];
  linkedProductionQuantity: number;
  jobId: string | null;
};

// Shop-floor inspection execution view for job operations with
// operationType = 'Inspection'. Same concepts as the ERP quality module's
// InspectionView (features × samples matrix, ballooned drawing, AQL gating,
// Accept/Reject disposition) in the MES AssemblyView shell, with the standard
// shop-floor actions (timer, complete, scrap, rework, quality issue).
export function InspectionView({
  operationId,
  job,
  operation,
  inspection,
  samples,
  features,
  measurements,
  balloons,
  documentName,
  pdfUrl,
  issueTypes,
  trackedEntities,
  requiresSerialTracking,
  requiresBatchTracking,
  events,
  productionQuantities,
  linkedSampleIds,
  linkedProductionQuantity,
  jobId
}: InspectionViewProps) {
  const { t } = useLingui();
  const user = useUser();
  const mode = useMode();

  // Which entity the produced lot samples come from: the job make method's
  // WIP entities (the part being made), not receipt entities.
  const isSerial = requiresSerialTracking;
  const isTracked = requiresSerialTracking || requiresBatchTracking;

  const liveFeatures = useMemo(
    () => features.filter((f) => f.inspectionFeature != null),
    [features]
  );
  const hasFeatures = liveFeatures.length > 0;
  const showDrawing = pdfUrl != null;

  const scannerDisclosure = useDisclosure();
  const rejectDisclosure = useDisclosure();
  const partialDisclosure = useDisclosure();
  const acceptDisclosure = useDisclosure();
  const actionsSheet = useDisclosure();
  const qualityModal = useDisclosure();
  const scrapModal = useDisclosure();
  const finishModal = useDisclosure();
  const reworkModal = useDisclosure();

  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);

  // PDF-over-table stack (ERP quality InspectionView's layout model): pinned PDF
  // height while the table is expanded, with a draggable splitter between them.
  const [gridExpanded, setGridExpanded] = useState(true);
  const [pdfPaneHeightPx, setPdfPaneHeightPx] = useState(360);
  const [stackHeightPx, setStackHeightPx] = useState(0);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitDragRef = useRef<{ startY: number; startPdfPx: number } | null>(
    null
  );
  // Until the user drags the splitter, the PDF takes ~45% of the measured stack
  // (capped by the table's half-stack minimum) instead of a fixed pixel default.
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
  const remaining = useMemo(
    () => trackedEntities.filter((e) => !sampledIds.has(e.id)),
    [trackedEntities, sampledIds]
  );

  const lotClosed =
    inspection.dispositionedAt != null &&
    (inspection.status === "Passed" ||
      inspection.status === "Failed" ||
      inspection.status === "Partial");

  // Outcome bookkeeping, mirrored from the disposition route's server-side
  // buckets (which recompute and clamp — these drive the header affordances).
  const opAttrKey = `Operation ${operationId}`;
  const entityOpenAtOp = useCallback(
    (entity: TrackedEntity) => {
      if (entity.status === "Consumed" || entity.status === "Rejected") {
        return false;
      }
      const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
      return !attributes[opAttrKey];
    },
    [opAttrKey]
  );
  const linkedSampleIdSet = useMemo(
    () => new Set(linkedSampleIds),
    [linkedSampleIds]
  );
  const entityById = useMemo(
    () => new Map(trackedEntities.map((e) => [e.id, e])),
    [trackedEntities]
  );
  const failedEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sample of samples) {
      if (
        sampleStatuses.get(sample.id) === "Failed" &&
        sample.trackedEntityId
      ) {
        ids.add(sample.trackedEntityId);
      }
    }
    return ids;
  }, [samples, sampleStatuses]);

  const opRemaining = Math.max(
    0,
    (operation.targetQuantity ?? operation.operationQuantity ?? 0) -
      (operation.quantityComplete ?? 0) -
      (operation.quantityScrapped ?? 0) -
      (operation.quantityReworked ?? 0)
  );

  // Passed but not yet posted — the "Complete passed (n)" affordance.
  const completablePassed = isSerial
    ? samples.filter((sample) => {
        if (sampleStatuses.get(sample.id) !== "Passed") return false;
        if (linkedSampleIdSet.has(sample.id)) return false;
        const entity = sample.trackedEntityId
          ? entityById.get(sample.trackedEntityId)
          : undefined;
        return entity != null && entityOpenAtOp(entity);
      }).length
    : Math.min(
        Math.max(0, passes - linkedProductionQuantity),
        Math.max(0, opRemaining)
      );

  // What Accept will complete: the open remainder, minus failed units.
  const acceptRemaining = isSerial
    ? trackedEntities.filter(
        (entity) => entityOpenAtOp(entity) && !failedEntityIds.has(entity.id)
      ).length
    : opRemaining;

  // Serial units the reject/partial allocator can route: Reject condemns the
  // whole open remainder; Partial routes only the failed units.
  const allocatableUnits = useMemo<AllocatableUnit[]>(() => {
    if (!isSerial) return [];
    const units = trackedEntities
      .filter((entity) => entityOpenAtOp(entity))
      .map((entity) => ({
        trackedEntityId: entity.id,
        label: entity.readableId ?? entity.id.slice(0, 8),
        failed: failedEntityIds.has(entity.id)
      }));
    // Failed first — they're the reason the operator is here.
    return units.sort((a, b) => Number(b.failed) - Number(a.failed));
  }, [isSerial, trackedEntities, entityOpenAtOp, failedEntityIds]);

  const eventIds = {
    setupProductionEventId: events.find((e) => e.type === "Setup" && !e.endTime)
      ?.id,
    laborProductionEventId: events.find((e) => e.type === "Labor" && !e.endTime)
      ?.id,
    machineProductionEventId: events.find(
      (e) => e.type === "Machine" && !e.endTime
    )?.id
  };

  // Partial is the terminal mixed close — only once every unit has a verdict.
  const canPartial =
    !lotClosed && inspected >= inspection.lotSize && passes > 0 && fails > 0;

  // Serial lots build their sample columns by scanning tracked entities. The
  // header "Add Sample" button stays primary until the plan's sample size is
  // covered; a fresh serial lot auto-opens the scanner so the first scan is
  // one tap away.
  const allSamplesLoaded = samples.length >= inspection.sampleSize;
  const hasAutoOpenedScanRef = useRef(false);
  useEffect(() => {
    if (hasAutoOpenedScanRef.current) return;
    if (isSerial && samples.length === 0 && !lotClosed) {
      hasAutoOpenedScanRef.current = true;
      scannerDisclosure.onOpen();
    }
  }, [isSerial, samples.length, lotClosed, scannerDisclosure]);

  const maxSampleSize = hasFeatures
    ? Math.max(1, ...liveFeatures.map((f) => f.sampleSize))
    : inspection.sampleSize;

  // Gating mirrors the server-side disposition guards: feature-driven lots
  // gate per feature; lots without features gate at the lot level on
  // the "Overall result" pass/fail counts.
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
    canAccept = !lotClosed && allFeaturesSatisfied;
    canReject = !lotClosed && (anyFeatureRejectable || fails > 0);
  } else {
    canAccept =
      !lotClosed &&
      inspected >= inspection.sampleSize &&
      fails <= inspection.acceptanceNumber;
    canReject = !lotClosed && fails > inspection.acceptanceNumber;
  }

  const failedFeatureSummary = useMemo<FailedFeatureSummary[]>(() => {
    if (!hasFeatures) return [];
    return liveFeatures
      .map((lotFeature) => {
        const feature = lotFeature.inspectionFeature!;
        const failedValues: string[] = [];
        for (const m of effectiveMeasurements.values()) {
          if (m.featureId !== feature.id || m.status !== "Failed") continue;
          failedValues.push(m.value == null ? "F" : String(m.value));
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

  const drawingBalloons = useMemo(() => {
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

  const statusBadgeVariant =
    inspection.status === "Passed"
      ? ("green" as const)
      : inspection.status === "Failed"
        ? ("red" as const)
        : inspection.status === "Partial"
          ? ("yellow" as const)
          : ("secondary" as const);

  const planSummary =
    inspection.samplingPlanType === "AQL"
      ? `AQL ${inspection.aql ?? ""} · Lvl ${inspection.inspectionLevel ?? ""} · ${inspection.severity ?? ""}`
      : inspection.samplingPlanType;

  // Timers: one control per configured work type (single-phase clocking, same
  // contract as the assembly view's TimerControl → /x/event).
  const workTypes = useMemo<WorkType[]>(() => {
    const list: WorkType[] = [];
    if ((operation.setupDuration ?? 0) > 0) list.push("Setup");
    if ((operation.laborDuration ?? 0) > 0) list.push("Labor");
    if ((operation.machineDuration ?? 0) > 0) list.push("Machine");
    return list.length > 0 ? list : ["Labor"];
  }, [operation]);

  const openEventForWorkType = useCallback(
    (type: WorkType) =>
      (events.find((e) => e.type === type && !e.endTime) as
        | { id: string; startTime: string }
        | undefined) ?? null,
    [events]
  );
  const openByType = (type: string) =>
    (events.find((e) => e.type === type && !e.endTime) ?? undefined) as
      | ProductionEvent
      | undefined;

  // The next unit still to build is the natural target for completes; a batch
  // parent shares one lot entity across every unit.
  const quantityComplete = Math.max(
    0,
    Math.round((operation.quantityComplete as number) ?? 0)
  );
  const completeEntityId = requiresBatchTracking
    ? (trackedEntities[0]?.id ?? "")
    : requiresSerialTracking
      ? (trackedEntities[quantityComplete]?.id ?? trackedEntities[0]?.id ?? "")
      : "";

  const companyLogo =
    mode === "dark" ? user.company.logoDarkIcon : user.company.logoLightIcon;

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── HEADER ── */}
      <header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border">
        <SidebarTrigger className="h-full w-auto shrink-0 rounded-none border-r border-border px-2 hover:bg-accent md:px-4" />
        {companyLogo ? (
          <div className="hidden h-full shrink-0 items-center border-r border-border px-4 sm:flex">
            <img
              src={companyLogo}
              alt={`${user.company.name} logo`}
              className="h-7 w-auto max-w-[140px] object-contain"
            />
          </div>
        ) : null}

        <div className="flex h-full min-w-0 items-center gap-2 border-r border-border px-3 md:px-5">
          <span className="truncate text-sm font-semibold">
            {inspection.inspectionId}
          </span>
          <Badge variant={statusBadgeVariant}>{inspection.status}</Badge>
          <span className="hidden text-muted-foreground md:inline">·</span>
          <span className="hidden truncate text-sm text-foreground/90 md:inline">
            {inspection.itemReadableId ?? job?.itemReadableIdWithRevision}
          </span>
          {operation?.description ? (
            <>
              <span className="hidden text-muted-foreground lg:inline">·</span>
              <span className="hidden truncate text-sm text-foreground/90 lg:inline">
                {operation.description}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex-1" />

        {isSerial && !lotClosed ? (
          <button
            type="button"
            onClick={scannerDisclosure.onOpen}
            className={cn(
              "hidden h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium transition-colors hover:bg-accent active:scale-[0.98] md:gap-2 md:px-4 lg:flex",
              !allSamplesLoaded && "text-primary"
            )}
          >
            <LuScan className="size-4" />
            <Trans>Add Sample</Trans>
          </button>
        ) : null}
        {!lotClosed && completablePassed > 0 ? (
          <CompletePassedButton
            inspectionId={inspection.id}
            operationId={operationId}
            count={completablePassed}
            eventIds={eventIds}
          />
        ) : null}
        <button
          type="button"
          onClick={rejectDisclosure.onOpen}
          disabled={!canReject}
          className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-red-600 transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 md:gap-2 md:px-4"
        >
          <LuX className="size-4" />
          <span className="hidden sm:inline">
            <Trans>Reject</Trans>
          </span>
        </button>
        {canPartial ? (
          <button
            type="button"
            onClick={partialDisclosure.onOpen}
            className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-amber-600 transition-colors hover:bg-accent active:scale-[0.98] dark:text-amber-400 md:gap-2 md:px-4"
          >
            <LuContrast className="size-4" />
            <span className="hidden sm:inline">
              <Trans>Partial</Trans>
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={acceptDisclosure.onOpen}
          disabled={!canAccept}
          className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 md:gap-2 md:px-4"
        >
          <LuCheck className="size-4" />
          <span className="hidden sm:inline">
            <Trans>Accept</Trans>
          </span>
        </button>
        <button
          type="button"
          aria-label={t`More actions`}
          onClick={actionsSheet.onOpen}
          className="flex h-full shrink-0 items-center justify-center border-l border-border px-2 transition-colors hover:bg-accent active:scale-[0.98] md:px-4"
        >
          <LuEllipsisVertical className="size-4" />
        </button>

        {workTypes.map((wt) => (
          <TimerControl
            key={wt}
            operationId={operationId}
            workCenterId={operation.workCenterId ?? undefined}
            openEvent={openEventForWorkType(wt)}
            workType={wt}
          />
        ))}
      </header>

      {/* ── META BAR ── */}
      <div className="flex h-9 shrink-0 items-center gap-3 overflow-x-auto bg-card border-b border-border px-5 scrollbar-hide">
        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {inspected} / {inspection.sampleSize} <Trans>inspected</Trans> · Ac{" "}
          {inspection.acceptanceNumber} · Re {inspection.rejectionNumber}
          {inspection.codeLetter ? ` · ${inspection.codeLetter}` : ""}
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {planSummary}
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          <Trans>Lot</Trans> {inspection.lotSize}
        </span>
        {documentName ? (
          <span className="truncate text-xs text-muted-foreground">
            {documentName}
          </span>
        ) : null}
        <div className="flex-1" />
        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          <Trans>Completed</Trans> {productionQuantities.production} ·{" "}
          <Trans>Scrap</Trans> {productionQuantities.scrap} ·{" "}
          <Trans>Rework</Trans> {productionQuantities.rework}
        </span>
      </div>

      {/* ── BODY ── */}
      {showDrawing ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2">
          <div
            ref={stackRef}
            className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
          >
            {/* PDF viewer — pinned height while the features table is expanded */}
            <div
              className={cn(
                "flex min-h-0 min-w-full flex-col overflow-hidden rounded-lg border bg-muted",
                gridExpanded ? "shrink-0" : "min-h-[220px] flex-1"
              )}
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
                className={cn(
                  "group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center rounded-md px-2 hover:bg-muted/80",
                  isResizingSplit && "bg-muted"
                )}
                onMouseDown={onSplitResizeMouseDown}
              >
                <span className="h-1 w-14 shrink-0 rounded-full bg-muted-foreground/40 group-hover:bg-muted-foreground/65" />
              </div>
            ) : null}

            {/* Features table — collapsible bottom panel */}
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
              <div className="flex min-h-10 flex-shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {t`Features`}
                </span>
                <IconButton
                  type="button"
                  variant="ghost"
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
              </div>
              <InspectionMeasurementMatrix
                inspectionId={inspection.id}
                isReadOnly={lotClosed}
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
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
            <InspectionMeasurementMatrix
              inspectionId={inspection.id}
              isReadOnly={lotClosed}
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
      )}

      {/* ── MODALS ── */}
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

      {acceptDisclosure.isOpen && (
        <AcceptLotModal
          inspectionId={inspection.id}
          operationId={operationId}
          fails={fails}
          remaining={acceptRemaining}
          eventIds={eventIds}
          onClose={acceptDisclosure.onClose}
        />
      )}

      {rejectDisclosure.isOpen && (
        <DispositionModal
          decision="Reject"
          inspectionId={inspection.id}
          operationId={operationId}
          isSerial={isSerial}
          units={allocatableUnits}
          maxAllocatable={opRemaining}
          completions={0}
          issueTypes={issueTypes}
          summary={t`Statistical acceptance failed, so the entire lot of ${inspection.lotSize} is considered non-conforming (ISO 9001:2015 §8.7) — ${passes} sampled pass(es) and ${fails} failure(s). Route the units below to scrap or rework, or record the verdict only.`}
          failedFeatureSummary={failedFeatureSummary}
          eventIds={eventIds}
          onCancel={rejectDisclosure.onClose}
          onSubmit={rejectDisclosure.onClose}
        />
      )}

      {partialDisclosure.isOpen && (
        <DispositionModal
          decision="Partial"
          inspectionId={inspection.id}
          operationId={operationId}
          isSerial={isSerial}
          units={allocatableUnits.filter((unit) => unit.failed)}
          maxAllocatable={isSerial ? fails : Math.min(fails, opRemaining)}
          completions={completablePassed}
          issueTypes={issueTypes}
          summary={t`Every unit has a verdict: ${passes} passed and ${fails} failed. The lot closes with each unit routed to its own outcome.`}
          failedFeatureSummary={failedFeatureSummary}
          eventIds={eventIds}
          onCancel={partialDisclosure.onClose}
          onSubmit={partialDisclosure.onClose}
        />
      )}

      <QualityIssueModal
        operationId={operationId}
        trackedEntityId={
          isTracked ? (trackedEntities[0]?.id ?? undefined) : undefined
        }
        isOpen={qualityModal.isOpen}
        onClose={qualityModal.onClose}
      />

      {scrapModal.isOpen && operation && (
        <QuantityModal
          type="scrap"
          operation={operation}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={completeEntityId}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          onClose={scrapModal.onClose}
        />
      )}

      {finishModal.isOpen && operation && (
        <QuantityModal
          type="finish"
          operation={operation}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={completeEntityId}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          allStepsRecorded
          onClose={finishModal.onClose}
        />
      )}

      {reworkModal.isOpen && operation && jobId && (
        <ReworkModal
          operation={operation}
          jobId={jobId}
          isOpen={reworkModal.isOpen}
          onClose={reworkModal.onClose}
          trackedEntities={trackedEntities as never}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
        />
      )}

      <BottomSheet
        open={actionsSheet.isOpen}
        onOpenChange={(open) => {
          if (!open) actionsSheet.onClose();
        }}
      >
        <BottomSheetContent className="mx-auto max-w-md">
          <BottomSheetBody>
            <div className="flex flex-col gap-2 pb-2">
              <ActionSheetButton
                icon={<LuTrash className="size-4 shrink-0" />}
                label={t`Scrap`}
                onClick={() => {
                  actionsSheet.onClose();
                  scrapModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuGitPullRequest className="size-4 shrink-0" />}
                label={t`Rework`}
                onClick={() => {
                  actionsSheet.onClose();
                  reworkModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuCheck className="size-4 shrink-0" />}
                label={t`Finish`}
                onClick={() => {
                  actionsSheet.onClose();
                  finishModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuFlag className="size-4 shrink-0" />}
                label={t`Quality Issue`}
                onClick={() => {
                  actionsSheet.onClose();
                  qualityModal.onOpen();
                }}
              />
              {isSerial && !lotClosed ? (
                <ActionSheetButton
                  icon={<LuScan className="size-4 shrink-0" />}
                  label={t`Add Sample`}
                  onClick={() => {
                    actionsSheet.onClose();
                    scannerDisclosure.onOpen();
                  }}
                />
              ) : null}
            </div>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>

      {/* Inspecting is work: start the labor clock on open whenever no clock
          is running (any work type — the exclusive start would end it).
          Always on for inspections, independent of the company-level
          autoStartOperationTimer setting. */}
      <AutoTimer
        operationId={operationId}
        workType={workTypes.includes("Labor") ? "Labor" : workTypes[0]}
        workCenterId={operation.workCenterId ?? undefined}
        openEvent={
          (events.find((e) => !e.endTime) as
            | { id: string; startTime: string }
            | undefined) ?? null
        }
      />
    </div>
  );
}

type ProductionEventIdFields = {
  setupProductionEventId?: string;
  laborProductionEventId?: string;
  machineProductionEventId?: string;
};

function EventIdInputs({ eventIds }: { eventIds: ProductionEventIdFields }) {
  return (
    <>
      {eventIds.setupProductionEventId ? (
        <input
          type="hidden"
          name="setupProductionEventId"
          value={eventIds.setupProductionEventId}
        />
      ) : null}
      {eventIds.laborProductionEventId ? (
        <input
          type="hidden"
          name="laborProductionEventId"
          value={eventIds.laborProductionEventId}
        />
      ) : null}
      {eventIds.machineProductionEventId ? (
        <input
          type="hidden"
          name="machineProductionEventId"
          value={eventIds.machineProductionEventId}
        />
      ) : null}
    </>
  );
}

// Progressive completion of what has passed so far, while the lot stays open.
function CompletePassedButton({
  inspectionId,
  operationId,
  count,
  eventIds
}: {
  inspectionId: string;
  operationId: string;
  count: number;
  eventIds: ProductionEventIdFields;
}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  return (
    <fetcher.Form
      method="post"
      action={path.to.inspectionCompletePassed(inspectionId)}
      className="h-full shrink-0"
    >
      <input type="hidden" name="operationId" value={operationId} />
      <EventIdInputs eventIds={eventIds} />
      <button
        type="submit"
        disabled={busy}
        className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 md:gap-2 md:px-4"
      >
        <LuCheckCheck className="size-4" />
        <span className="hidden tabular-nums sm:inline">
          <Trans>Complete passed</Trans> {count}
        </span>
      </button>
    </fetcher.Form>
  );
}

function AcceptLotModal({
  inspectionId,
  operationId,
  fails,
  remaining,
  eventIds,
  onClose
}: {
  inspectionId: string;
  operationId: string;
  fails: number;
  remaining: number;
  eventIds: ProductionEventIdFields;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onClose();
      submitted.current = false;
    }
  }, [fetcher.state, onClose]);

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
            <Trans>Accept lot?</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={2}>
            <p className="text-sm text-muted-foreground">
              <Trans>
                The lot will be marked Passed and {remaining} remaining unit(s)
                will be completed at this operation.
              </Trans>
            </p>
            {fails > 0 ? (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  {fails} sampled failure(s) are recorded and will NOT be
                  completed — resolve them from the actions menu.
                </Trans>
              </p>
            ) : null}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.inspectionDisposition(inspectionId)}
            onSubmit={() => (submitted.current = true)}
          >
            <input type="hidden" name="decision" value="Accept" />
            <input type="hidden" name="operationId" value={operationId} />
            <EventIdInputs eventIds={eventIds} />
            <Button
              type="submit"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              <Trans>Accept Lot</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ActionSheetButton({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 transition-transform active:scale-[0.98]"
      onClick={onClick}
    >
      {icon}
      <span className="text-base/6 font-medium">{label}</span>
    </button>
  );
}

// Passive operation timer (opt-in) — same one-shot contract as the assembly
// view's AutoTimer: auto-starts the operator's production event on open,
// never auto-ends one.
function AutoTimer({
  operationId,
  workType,
  workCenterId,
  openEvent
}: {
  operationId: string;
  workType: WorkType;
  workCenterId?: string;
  openEvent: { id: string; startTime: string } | null;
}) {
  const fetcher = useFetcher();
  const startedRef = useRef(false);

  const busy = fetcher.state !== "idle";
  const running = !!openEvent;

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on open
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (running || busy) return;
    const fd = new FormData();
    fd.set("jobOperationId", operationId);
    fd.set("timezone", getLocalTimeZone());
    fd.set("type", workType);
    fd.set("action", "Start");
    fd.set("exclusive", "true");
    if (workCenterId) fd.set("workCenterId", workCenterId);
    fetcher.submit(fd, { method: "post", action: path.to.productionEvent });
  }, []);

  return null;
}

function formatElapsed(s: number) {
  const h = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// Live elapsed seconds from an open production event's startTime.
function useElapsed(openEvent: { startTime: string } | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!openEvent) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [openEvent]);
  if (!openEvent) return 0;
  const start = new Date(openEvent.startTime).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

// Single-phase clocking control — posts Start/End to /x/event with
// exclusive=true so starting one work type ends any other open one. Same
// contract as the assembly view's TimerControl.
function TimerControl({
  operationId,
  workCenterId,
  openEvent,
  workType
}: {
  operationId: string;
  workCenterId?: string;
  openEvent: { id: string; startTime: string } | null;
  workType: WorkType;
}) {
  const fetcher = useFetcher();

  // Optimistic state: flip the moment Start/End is submitted instead of
  // waiting for the post-production-event round-trip.
  const pendingAction = fetcher.formData?.get("action");
  const active =
    pendingAction === "Start"
      ? true
      : pendingAction === "End"
        ? false
        : !!openEvent;

  const liveElapsed = useElapsed(pendingAction === "End" ? null : openEvent);
  const elapsed = pendingAction === "End" ? 0 : liveElapsed;

  return (
    <fetcher.Form
      method="post"
      action={path.to.productionEvent}
      className="h-full shrink-0"
    >
      <input type="hidden" name="jobOperationId" value={operationId} />
      <input type="hidden" name="timezone" value={getLocalTimeZone()} />
      <input type="hidden" name="type" value={workType} />
      <input type="hidden" name="exclusive" value="true" />
      <input type="hidden" name="action" value={openEvent ? "End" : "Start"} />
      {workCenterId ? (
        <input type="hidden" name="workCenterId" value={workCenterId} />
      ) : null}
      {openEvent ? (
        <input type="hidden" name="id" value={openEvent.id} />
      ) : null}
      <button
        type="submit"
        aria-label={active ? "Pause timer" : "Start timer"}
        className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 transition-colors hover:bg-accent active:scale-[0.98] md:gap-2 md:px-4"
      >
        <span className="hidden flex-col items-end leading-none sm:flex">
          <span className="text-sm font-medium tabular-nums">
            {formatElapsed(elapsed)}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {workType}
          </span>
        </span>
        {active ? (
          <LuPause className="size-4" />
        ) : (
          <LuPlay className="size-4" />
        )}
      </button>
    </fetcher.Form>
  );
}

export default InspectionView;
