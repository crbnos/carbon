// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  ClientOnly,
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
  Textarea,
  useDisclosure,
  useMode,
  useViewport,
  VStack
} from "@carbon/react";
import {
  formatSpecLabel,
  INSPECTION_DRAWING_HIDDEN_STORAGE_KEY
} from "@carbon/utils";
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
import { LuCheck, LuEye, LuEyeOff, LuX } from "react-icons/lu";
import { useSearchParams } from "react-router";
import { useQueueTitles } from "~/components/AppSidebar";
import { MesAppBar } from "~/components/MesAppBar";
import { useMesBottomBar } from "~/components/MesBottomBar";
import { useUser } from "~/hooks";
import type {
  InspectionGauge,
  InspectionMeasurement,
  Inspection as InspectionRow,
  InspectionSample,
  InspectionSamplingPlan,
  InspectionTrackedEntity
} from "~/services/types";
import { OriginInput, readOrigin, useOrigin } from "~/utils/origin";
import { path } from "~/utils/path";
import type { MeasurementSaveResult } from "./InspectionMeasurementMatrix";
import InspectionMeasurementMatrix from "./InspectionMeasurementMatrix";
import type { InspectionParameter } from "./InspectionParameters";
import { InspectionParametersButton } from "./InspectionParameters";

const InspectionDrawingPane = lazy(() => import("./InspectionDrawingPane"));
const ModelUploadPreview = lazy(
  () => import("@carbon/viewer/model-upload-preview")
);

type DrawingBalloonRow = {
  id: string;
  inspectionFeatureId: string;
  pageNumber: number;
  xCoordinate: number;
  yCoordinate: number;
  regionX: number;
  regionY: number;
  regionWidth: number;
  regionHeight: number;
};

type ManualInspectionViewProps = {
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
  gauges: InspectionGauge[];
  recentGaugeIds: string[];
  // The tracked entities the lot covers: the only units a sample may be.
  lotEntities: InspectionTrackedEntity[];
  workCenterName: string | null;
  balloons: DrawingBalloonRow[];
  documentName: string | null;
  parameters: InspectionParameter[];
  pdfUrl: string | null;
  model: { modelUploadId: string; modelPath: string | null } | null;
};

/**
 * Shop-floor execution of a manual inspection: the same matrix, drawing and
 * scanner as a job-operation lot, without the operation around it (no timer,
 * no completions, no scrap or rework). The verdict only moves the lot's
 * tracked entities, so the header has Accept and Reject and nothing else.
 */
export function ManualInspectionView({
  inspection,
  samples,
  features,
  measurements,
  gauges,
  recentGaugeIds,
  lotEntities,
  workCenterName,
  balloons,
  documentName,
  parameters,
  pdfUrl,
  model
}: ManualInspectionViewProps) {
  const bottomBarRef = useMesBottomBar();
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const user = useUser();
  const mode = useMode();
  const titles = useQueueTitles();

  // Back returns to the page the lot was opened from, else the Inspections
  // queue (not Schedule, the default of an operation).
  const [searchParams] = useSearchParams();
  const origin = useOrigin();
  const back = readOrigin(searchParams)
    ? origin
    : { to: path.to.inspections, label: titles.inspections };

  const isSerial = inspection.item?.itemTrackingType === "Serial";

  const liveFeatures = useMemo(
    () => features.filter((f) => f.inspectionFeature != null),
    [features]
  );
  const hasFeatures = liveFeatures.length > 0;
  const hasDrawing = pdfUrl != null || model != null;
  const [drawingHidden, setDrawingHidden] = useState(false);
  useEffect(() => {
    try {
      setDrawingHidden(
        window.localStorage.getItem(INSPECTION_DRAWING_HIDDEN_STORAGE_KEY) ===
          "true"
      );
    } catch {
      // Storage unavailable: keep the drawing shown.
    }
  }, []);
  const toggleDrawing = useCallback(() => {
    setDrawingHidden((hidden) => {
      try {
        window.localStorage.setItem(
          INSPECTION_DRAWING_HIDDEN_STORAGE_KEY,
          String(!hidden)
        );
      } catch {
        // Storage unavailable: the choice lasts for this page only.
      }
      return !hidden;
    });
  }, []);
  const showDrawing = hasDrawing && !drawingHidden;
  // Matrix position -> sample id, kept here so it survives the matrix
  // remount when the drawing is hidden or shown.
  const placementRef = useRef<Record<number, string>>({});
  // A save in flight: the verdict waits until every reading has landed.
  const [gridBusy, setGridBusy] = useState(false);

  const rejectDisclosure = useDisclosure();
  const acceptDisclosure = useDisclosure();

  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);

  // Per-cell saves are quiet (no revalidation), so measurement and derived
  // sample statuses are mirrored from the save responses for gating.
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
      byKey.set(key, {
        featureId: key.split(":")[1] ?? "",
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
    for (const sample of samples) statuses.set(sample.id, sample.status);
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

  const isLocked =
    inspection.status === "Passed" ||
    inspection.status === "Failed" ||
    inspection.status === "Partial" ||
    inspection.status === "Cancelled";

  // No scanner: the serials picked when the inspection was created are its
  // samples from the start, one column each.

  const maxSampleSize = hasFeatures
    ? Math.max(1, ...liveFeatures.map((f) => f.sampleSize))
    : inspection.sampleSize;

  // Accept gating mirrors dispositionInspection: every characteristic has
  // its n recorded within its acceptance number, or — with no plan — the lot's
  // samples are in within Ac. `failedStatistically` is the engine's
  // isRejectableWithoutReason: when false, a Reject needs a reason.
  let canAccept: boolean;
  let failedStatistically: boolean;
  if (hasFeatures) {
    canAccept =
      !isLocked &&
      liveFeatures.every((feature) => {
        const counts = featureCounts.get(feature.inspectionFeatureId) ?? {
          recorded: 0,
          failed: 0
        };
        return (
          counts.recorded >= feature.sampleSize &&
          counts.failed <= feature.acceptanceNumber
        );
      });
    failedStatistically =
      liveFeatures.some((feature) => {
        const counts = featureCounts.get(feature.inspectionFeatureId);
        return counts != null && counts.failed >= feature.rejectionNumber;
      }) || fails > 0;
  } else {
    canAccept =
      !isLocked &&
      inspected >= inspection.sampleSize &&
      fails <= inspection.acceptanceNumber;
    failedStatistically = fails > inspection.acceptanceNumber;
  }
  if (gridBusy) canAccept = false;
  const canReject = !isLocked && !gridBusy;

  const failedFeatureLabels = useMemo(() => {
    if (!hasFeatures) return [];
    return liveFeatures
      .filter((lotFeature) =>
        [...effectiveMeasurements.values()].some(
          (m) =>
            m.featureId === lotFeature.inspectionFeatureId &&
            m.status === "Failed"
        )
      )
      .map(
        (lotFeature) =>
          `${lotFeature.inspectionFeature!.label} (${formatSpecLabel(lotFeature.inspectionFeature!)})`
      );
  }, [hasFeatures, liveFeatures, effectiveMeasurements]);

  const pmiLinks = useMemo(
    () =>
      liveFeatures.map((f) => ({
        id: f.inspectionFeatureId,
        pmiItemId: f.inspectionFeature!.pmiItemId ?? null
      })),
    [liveFeatures]
  );
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
        ...b,
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

  const companyLogo =
    mode === "dark" ? user.company.logoDarkIcon : user.company.logoLightIcon;

  const matrix = (toolbarActions?: React.ReactNode) => (
    <InspectionMeasurementMatrix
      inspectionId={inspection.id}
      isReadOnly={isLocked}
      isSerial={isSerial}
      features={features}
      samples={samples}
      measurements={measurements}
      gauges={gauges}
      recentGaugeIds={recentGaugeIds}
      maxSampleSize={maxSampleSize}
      lotSize={inspection.lotSize}
      lotAcceptanceNumber={inspection.acceptanceNumber}
      lotRejectionNumber={inspection.rejectionNumber}
      activeFeatureId={activeFeatureId}
      onActiveFeatureChange={setActiveFeatureId}
      onMeasurementSaved={onMeasurementSaved}
      placementRef={placementRef}
      onBusyChange={setGridBusy}
      toolbarActions={toolbarActions}
    />
  );

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── HEADER ── */}
      <MesAppBar
        title={inspection.inspectionId}
        subtitle={back.label}
        back={{ to: back.to }}
      />
      {!isPhone && (
        <header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border max-md:hidden">
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
            <h1 className="shrink-0 text-sm font-semibold">
              {inspection.inspectionId}
            </h1>
            <Badge
              variant={statusBadgeVariant}
              className="shrink-0 max-lg:hidden"
            >
              {inspection.status}
            </Badge>
            <span className="hidden text-muted-foreground xl:inline">·</span>
            <span className="hidden truncate text-sm text-foreground/90 xl:inline">
              {inspection.itemReadableId ?? inspection.item?.readableId}
            </span>
            {workCenterName ? (
              <>
                <span className="hidden text-muted-foreground xl:inline">
                  ·
                </span>
                <span className="hidden truncate text-sm text-foreground/90 xl:inline">
                  {workCenterName}
                </span>
              </>
            ) : null}
          </div>

          <div className="flex-1" />

          <button
            title={t`Reject`}
            aria-label={t`Reject`}
            type="button"
            onClick={rejectDisclosure.onOpen}
            disabled={!canReject}
            className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-red-600 transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 md:gap-2 md:px-4"
          >
            <LuX className="size-4" />
            <span className="hidden lg:inline">
              <Trans>Reject</Trans>
            </span>
          </button>
          <button
            title={t`Accept`}
            aria-label={t`Accept`}
            type="button"
            onClick={acceptDisclosure.onOpen}
            disabled={!canAccept}
            className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 md:gap-2 md:px-4"
          >
            <LuCheck className="size-4" />
            <span className="hidden lg:inline">
              <Trans>Accept</Trans>
            </span>
          </button>
        </header>
      )}

      <div className="contents max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:overflow-y-auto">
        {/* ── META BAR ── */}
        <div className="flex h-9 shrink-0 items-center gap-3 overflow-x-auto bg-card border-b border-border px-5 scrollbar-hide max-md:h-auto max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1 max-md:px-4 max-md:py-1.5">
          <Badge variant={statusBadgeVariant} className="shrink-0 lg:hidden">
            {inspection.status}
          </Badge>
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
            <span className="truncate text-xs text-muted-foreground max-md:max-w-full">
              {documentName}
            </span>
          ) : null}
          <InspectionParametersButton parameters={parameters} />
          {inspection.notes ? (
            <span className="truncate text-xs text-muted-foreground max-md:max-w-full">
              {inspection.notes}
            </span>
          ) : null}
        </div>

        {/* ── BODY ── */}
        {showDrawing ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 pb-4 pt-2">
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
                    {model ? (
                      <ModelUploadPreview
                        modelUploadId={model.modelUploadId}
                        modelPath={model.modelPath}
                        companyId={user.company.id}
                        pmiLinks={pmiLinks}
                        selectedLinkId={activeFeatureId}
                        onLinkSelect={setActiveFeatureId}
                        className="h-full rounded-none"
                      />
                    ) : (
                      <InspectionDrawingPane
                        pdfUrl={pdfUrl!}
                        balloons={drawingBalloons}
                        activeFeatureId={activeFeatureId}
                        onBalloonClick={setActiveFeatureId}
                      />
                    )}
                  </Suspense>
                )}
              </ClientOnly>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
              {matrix(
                <IconButton
                  type="button"
                  variant="ghost"
                  aria-label={t`Hide drawing`}
                  title={t`Hide drawing`}
                  icon={<LuEyeOff className="h-4 w-4" />}
                  isDisabled={gridBusy}
                  onClick={toggleDrawing}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2 max-md:flex-none max-md:overflow-visible">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card max-md:flex-initial">
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

      {/* Phones: the verdict as labelled 48px buttons in thumb reach. */}
      {isPhone && (
        <div
          ref={bottomBarRef}
          data-mes-bottom-bar
          className="flex shrink-0 gap-2 border-t border-border bg-card px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden [&>button]:min-w-0 [&>button]:flex-1"
        >
          <Button
            size="lg"
            variant="secondary"
            leftIcon={<LuX />}
            isDisabled={!canReject}
            onClick={rejectDisclosure.onOpen}
            className="h-12 text-red-600 dark:text-red-400"
          >
            <span className="truncate">
              <Trans>Reject</Trans>
            </span>
          </Button>
          <Button
            size="lg"
            leftIcon={<LuCheck />}
            isDisabled={!canAccept}
            onClick={acceptDisclosure.onOpen}
            className="h-12"
          >
            <span className="truncate">
              <Trans>Accept</Trans>
            </span>
          </Button>
        </div>
      )}

      {/* ── MODALS ── */}
      {acceptDisclosure.isOpen && (
        <VerdictModal
          decision="Accept"
          inspectionId={inspection.id}
          onClose={acceptDisclosure.onClose}
          description={
            fails > 0
              ? t`The inspection will be marked Passed. Its units are released to Available, except the ${fails} that failed a sample, which stay Rejected.`
              : t`The inspection will be marked Passed and its units released to Available.`
          }
        />
      )}

      {rejectDisclosure.isOpen && (
        <VerdictModal
          decision="Reject"
          inspectionId={inspection.id}
          onClose={rejectDisclosure.onClose}
          requireReason={!failedStatistically}
          failedFeatureLabels={failedFeatureLabels}
          description={
            failedStatistically
              ? t`The inspection failed: ${passes} sample(s) passed and ${fails} failed. All ${lotEntities.length} unit(s) will be Rejected.`
              : t`Nothing has failed yet, so say why the units are rejected. All ${lotEntities.length} unit(s) will be Rejected.`
          }
        />
      )}
    </div>
  );
}

function VerdictModal({
  decision,
  inspectionId,
  description,
  requireReason = false,
  failedFeatureLabels = [],
  onClose
}: {
  decision: "Accept" | "Reject";
  inspectionId: string;
  description: string;
  requireReason?: boolean;
  failedFeatureLabels?: string[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [reason, setReason] = useState("");
  const fetcher = useAction<{}>({});
  const busy = fetcher.state !== "idle";
  const missingReason = requireReason && reason.trim().length === 0;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <fetcher.Form
          method="post"
          action={path.to.inspectionVerdict(inspectionId)}
        >
          <ModalHeader>
            <ModalTitle>
              {decision === "Accept"
                ? t`Accept inspection?`
                : t`Reject inspection?`}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={3}>
              <p className="text-sm text-muted-foreground">{description}</p>
              {failedFeatureLabels.length > 0 ? (
                <VStack spacing={1}>
                  <span className="text-xs font-medium">
                    <Trans>Failed characteristics</Trans>
                  </span>
                  {failedFeatureLabels.map((label) => (
                    <span key={label} className="text-xs text-muted-foreground">
                      {label}
                    </span>
                  ))}
                </VStack>
              ) : null}
              {decision === "Reject" ? (
                <Textarea
                  name="reason"
                  aria-label={t`Reason`}
                  placeholder={
                    requireReason ? t`Reason (required)` : t`Reason (optional)`
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              ) : null}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <input type="hidden" name="decision" value={decision} />
            <OriginInput />
            <Button
              type="submit"
              variant={decision === "Reject" ? "destructive" : "primary"}
              isLoading={busy}
              isDisabled={busy || missingReason}
            >
              {decision === "Accept" ? (
                <Trans>Accept</Trans>
              ) : (
                <Trans>Reject</Trans>
              )}
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
}
