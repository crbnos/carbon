import {
  Badge,
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  Button,
  ClientOnly,
  cn,
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
  useMode
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
  JobMaterial,
  OperationWithDetails,
  ProductionEvent,
  TrackedEntity
} from "~/services/types";
import { path } from "~/utils/path";
import type { MeasurementSaveResult } from "./InspectionMeasurementMatrix";
import InspectionMeasurementMatrix from "./InspectionMeasurementMatrix";
import type { FailedFeatureSummary } from "./RejectLotModal";
import RejectLotModal from "./RejectLotModal";
import ScanInspectionSample from "./ScanInspectionSample";

const InspectionDrawingPane = lazy(() => import("./InspectionDrawingPane"));

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
  jobId: string | null;
  autoStartOperationTimer: boolean;
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
  jobId,
  autoStartOperationTimer
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
  const acceptDisclosure = useDisclosure();
  const actionsSheet = useDisclosure();
  const qualityModal = useDisclosure();
  const completeModal = useDisclosure();
  const scrapModal = useDisclosure();
  const finishModal = useDisclosure();
  const reworkModal = useDisclosure();

  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);

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
    (inspection.status === "Passed" || inspection.status === "Failed");

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
  // gate per characteristic; lots without features gate at the lot level on
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
          <div className="flex h-[45%] min-h-[220px] shrink-0 flex-col overflow-hidden rounded-lg border bg-muted">
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
          <div className="mt-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
            <InspectionMeasurementMatrix
              inspectionId={inspection.id}
              isReadOnly={lotClosed}
              isSerial={isSerial}
              features={features}
              samples={samples}
              measurements={measurements}
              maxSampleSize={maxSampleSize}
              lotAcceptanceNumber={inspection.acceptanceNumber}
              lotRejectionNumber={inspection.rejectionNumber}
              activeFeatureId={activeFeatureId}
              onActiveFeatureChange={setActiveFeatureId}
              onMeasurementSaved={onMeasurementSaved}
            />
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
          onClose={acceptDisclosure.onClose}
        />
      )}

      {rejectDisclosure.isOpen && (
        <RejectLotModal
          action={path.to.inspectionReject(inspection.id)}
          operationId={operationId}
          issueTypes={issueTypes}
          summary={t`Statistical acceptance failed, so the entire lot of ${inspection.lotSize} is considered non-conforming (ISO 9001:2015 §8.7) — ${passes} sampled pass(es) and ${fails} failure(s).`}
          failedFeatureSummary={failedFeatureSummary}
          onCancel={rejectDisclosure.onClose}
          onSubmit={rejectDisclosure.onClose}
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

      {completeModal.isOpen && operation && (
        <QuantityModal
          type="complete"
          operation={operation}
          materials={[] as JobMaterial[]}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={completeEntityId}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          allStepsRecorded
          onClose={completeModal.onClose}
        />
      )}

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
                icon={<LuCheck className="size-4 shrink-0" />}
                label={t`Log Completed`}
                onClick={() => {
                  actionsSheet.onClose();
                  completeModal.onOpen();
                }}
              />
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

      {autoStartOperationTimer && (
        <AutoTimer
          operationId={operationId}
          workType={workTypes[0]}
          workCenterId={operation.workCenterId ?? undefined}
          openEvent={openEventForWorkType(workTypes[0])}
        />
      )}
    </div>
  );
}

function AcceptLotModal({
  inspectionId,
  operationId,
  fails,
  onClose
}: {
  inspectionId: string;
  operationId: string;
  fails: number;
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
          <p className="text-sm text-muted-foreground">
            <Trans>
              The lot will be marked Passed. {fails} sampled failure(s) are
              recorded for your records.
            </Trans>
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.inspectionAccept(inspectionId)}
            onSubmit={() => (submitted.current = true)}
          >
            <input type="hidden" name="operationId" value={operationId} />
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
