// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import type { InspectionParameter, JSONContent } from "@carbon/react";
import {
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
  useDisclosure,
  useViewport,
  VStack
} from "@carbon/react";
import { formatSpecLabel } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuCheck,
  LuCheckCheck,
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
import { AbilityWarning } from "~/components/AbilityWarning";
import { QualityIssueModal } from "~/components/JobOperation/components/QualityIssueModal";
import { QuantityModal } from "~/components/JobOperation/components/QuantityModal";
import { ReworkModal } from "~/components/JobOperation/components/ReworkModal";
import { MesAppBar } from "~/components/MesAppBar";
import { useMesBottomBar } from "~/components/MesBottomBar";
import { ReworkBadge } from "~/components/ReworkBadge";
import type { AbilityShortfall } from "~/services/operations.service";
import type {
  InspectionGauge,
  InspectionMeasurement,
  InspectionSample,
  InspectionSamplingPlan,
  IssueTypeListItem,
  Job,
  OperationWithDetails,
  ProductionEvent,
  TrackedEntity
} from "~/services/types";
import { OriginInput, useOrigin } from "~/utils/origin";
import { path } from "~/utils/path";
import type { AllocatableUnit, FailedFeatureSummary } from "./DispositionModal";
import DispositionModal from "./DispositionModal";
import {
  InspectionLotBody,
  InspectionLotHeader,
  InspectionLotMetaBar
} from "./InspectionLotLayout";
import ScanInspectionSample from "./ScanInspectionSample";
import type { DrawingBalloonRow, InspectionLot } from "./useInspectionLotState";
import {
  isUnsampleableEntityStatus,
  useInspectionLotState
} from "./useInspectionLotState";

type WorkType = "Setup" | "Labor" | "Machine";

type InspectionViewProps = {
  abilityWarning?: AbilityShortfall | null;
  operationId: string;
  job: Job;
  operation: OperationWithDetails;
  /** The correction this rework operation belongs to, if any. */
  correctionName?: string | null;
  inspection: InspectionLot;
  samples: InspectionSample[];
  features: InspectionSamplingPlan[];
  measurements: InspectionMeasurement[];
  // Active gauges, and the ones most recently recorded at this operation's
  // work center, newest first.
  gauges: InspectionGauge[];
  recentGaugeIds: string[];
  balloons: DrawingBalloonRow[];
  documentName: string | null;
  parameters: InspectionParameter[];
  workInstruction: JSONContent | null;
  pdfUrl: string | null;
  /** A plan made from a model's PMI: the drawing pane shows the model. */
  model: { modelUploadId: string; modelPath: string | null } | null;
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
  abilityWarning,
  operationId,
  job,
  operation,
  correctionName,
  inspection,
  samples,
  features,
  measurements,
  gauges,
  recentGaugeIds,
  balloons,
  documentName,
  parameters,
  workInstruction,
  pdfUrl,
  model,
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
  const bottomBarRef = useMesBottomBar();
  const { t } = useLingui();
  const origin = useOrigin();
  const { isPhone } = useViewport();

  // Which entity the produced lot samples come from: the job make method's
  // WIP entities (the part being made), not receipt entities.
  const isSerial = requiresSerialTracking;
  const isTracked = requiresSerialTracking || requiresBatchTracking;

  const lotClosed =
    inspection.dispositionedAt != null &&
    (inspection.status === "Passed" ||
      inspection.status === "Failed" ||
      inspection.status === "Partial");

  // The process requires an ability this operator lacks and its policy is
  // Block: the lot is read-only for them, as if closed. The routes refuse too.
  const abilityBlocked = abilityWarning?.policy === "Block";
  const isLocked = lotClosed || abilityBlocked;

  const lot = useInspectionLotState({
    inspection,
    samples,
    features,
    measurements,
    balloons,
    lotEntities: trackedEntities,
    pdfUrl,
    model,
    isLocked
  });
  const {
    liveFeatures,
    hasFeatures,
    effectiveMeasurements,
    sampleStatuses,
    passes,
    fails,
    inspected,
    remaining,
    gridBusy,
    canAccept,
    canReject,
    failedStatistically
  } = lot;
  // Add Sample only while a unit the lot can still sample has no column: an
  // "inspect all" lot starts with every one sampled (prefillInspectionSamples).
  const canAddSample = isSerial && lot.hasSampleableUnit;

  const scannerDisclosure = useDisclosure();
  const rejectDisclosure = useDisclosure();
  const partialDisclosure = useDisclosure();
  const acceptDisclosure = useDisclosure();
  const actionsSheet = useDisclosure();
  const qualityModal = useDisclosure();
  const scrapModal = useDisclosure();
  const finishModal = useDisclosure();
  const reworkModal = useDisclosure();

  // Outcome bookkeeping, mirrored from the disposition route's server-side
  // buckets (which recompute and clamp — these drive the header affordances).
  const opAttrKey = `Operation ${operationId}`;
  const entityOpenAtOp = useCallback(
    (entity: TrackedEntity) => {
      if (isUnsampleableEntityStatus(entity.status)) return false;
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

  // Remaining GOOD work: scrap no longer counts toward targetQuantity
  // (20260807090629), so a scrapped unit doesn't reduce what's left to make —
  // its replacement still has to be completed.
  const opRemaining = Math.max(
    0,
    (operation.targetQuantity ?? operation.operationQuantity ?? 0) -
      (operation.quantityComplete ?? 0) -
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
  const showCompletePassed = !isLocked && completablePassed > 0;

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
    !isLocked && inspected >= inspection.lotSize && passes > 0 && fails > 0;

  // Serial lots build their sample columns by scanning tracked entities. The
  // header "Add Sample" button stays primary until the plan's sample size is
  // covered; a fresh serial lot auto-opens the scanner so the first scan is
  // one tap away.
  const allSamplesLoaded = samples.length >= inspection.sampleSize;
  const hasAutoOpenedScanRef = useRef(false);
  useEffect(() => {
    if (hasAutoOpenedScanRef.current) return;
    if (isSerial && samples.length === 0 && !isLocked) {
      hasAutoOpenedScanRef.current = true;
      scannerDisclosure.onOpen();
    }
  }, [isSerial, samples.length, isLocked, scannerDisclosure]);

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
        return {
          label: feature.label,
          spec: formatSpecLabel(feature),
          failedValues
        };
      })
      .filter(Boolean) as FailedFeatureSummary[];
  }, [hasFeatures, liveFeatures, effectiveMeasurements]);

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

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── HEADER ── */}
      <MesAppBar
        title={inspection.inspectionId}
        subtitle={origin.label}
        back={{ to: origin.to }}
        actions={
          <>
            {workTypes.map((wt) => (
              <TimerControl
                key={wt}
                operationId={operationId}
                workCenterId={operation.workCenterId ?? undefined}
                openEvent={openEventForWorkType(wt)}
                workType={wt}
                startDisabled={abilityBlocked}
              />
            ))}
            <IconButton
              aria-label={t`More actions`}
              variant="ghost"
              size="lg"
              icon={<LuEllipsisVertical />}
              onClick={actionsSheet.onOpen}
            />
          </>
        }
      />
      {/* Phones use the app bar above; one header mounts so its timers do too. */}
      <InspectionLotHeader
        inspection={inspection}
        lot={lot}
        itemLabel={inspection.itemReadableId ?? job?.itemReadableIdWithRevision}
        detail={operation?.description}
        badge={
          operation?.reworkId ? (
            <ReworkBadge correctionName={correctionName} />
          ) : null
        }
      >
        {canAddSample && !isLocked ? (
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
        {!isLocked && completablePassed > 0 ? (
          <CompletePassedButton
            inspectionId={inspection.id}
            operationId={operationId}
            count={completablePassed}
            eventIds={eventIds}
            gridBusy={gridBusy}
          />
        ) : null}
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
        {canPartial ? (
          <button
            title={t`Partial`}
            aria-label={t`Partial`}
            type="button"
            onClick={partialDisclosure.onOpen}
            disabled={gridBusy}
            className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-amber-600 transition-colors hover:bg-accent active:scale-[0.98] dark:text-amber-400 md:gap-2 md:px-4"
          >
            <LuContrast className="size-4" />
            <span className="hidden lg:inline">
              <Trans>Partial</Trans>
            </span>
          </button>
        ) : null}
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
            startDisabled={abilityBlocked}
          />
        ))}
      </InspectionLotHeader>

      {abilityWarning && (
        <div className="shrink-0 px-4 pt-3">
          <AbilityWarning warning={abilityWarning} />
        </div>
      )}

      <InspectionLotBody
        inspection={inspection}
        lot={lot}
        isSerial={isSerial}
        features={features}
        samples={samples}
        measurements={measurements}
        gauges={gauges}
        recentGaugeIds={recentGaugeIds}
        parameters={parameters}
        workInstruction={workInstruction}
        pdfUrl={pdfUrl}
        model={model}
        metaBar={
          <InspectionLotMetaBar
            inspection={inspection}
            lot={lot}
            documentName={documentName}
          >
            <div className="flex-1 max-md:hidden" />
            <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums max-md:order-first">
              <Trans>Completed</Trans> {productionQuantities.production} ·{" "}
              <Trans>Scrap</Trans> {productionQuantities.scrap} ·{" "}
              <Trans>Rework</Trans> {productionQuantities.rework}
            </span>
          </InspectionLotMetaBar>
        }
      />

      {/* Phones: the lot actions as labelled 48px buttons in thumb reach. */}
      {isPhone && (
        <div
          ref={bottomBarRef}
          data-mes-bottom-bar
          className="flex shrink-0 flex-wrap gap-2 border-t border-border bg-card px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden [&>button]:min-w-0 [&>button]:flex-1"
        >
          {/* Its label carries a count, so it takes a row of its own. */}
          {showCompletePassed ? (
            <div className="basis-full [&>*]:w-full">
              <CompletePassedButton
                inspectionId={inspection.id}
                operationId={operationId}
                count={completablePassed}
                eventIds={eventIds}
                gridBusy={gridBusy}
                variant="bar"
              />
            </div>
          ) : null}
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
          {canPartial ? (
            <Button
              size="lg"
              variant="secondary"
              leftIcon={<LuContrast />}
              onClick={partialDisclosure.onOpen}
              isDisabled={gridBusy}
              className="h-12 text-amber-600 dark:text-amber-400"
            >
              <span className="truncate">
                <Trans>Partial</Trans>
              </span>
            </Button>
          ) : null}
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
      <ScanInspectionSample
        open={scannerDisclosure.isOpen}
        inspectionId={inspection.id}
        isSerial={isSerial}
        remaining={remaining}
        inspected={inspected}
        sampleSize={inspection.sampleSize}
        fails={fails}
        acceptanceNumber={inspection.acceptanceNumber}
        onClose={scannerDisclosure.onClose}
      />

      <AcceptLotModal
        open={acceptDisclosure.isOpen}
        inspectionId={inspection.id}
        operationId={operationId}
        fails={fails}
        remaining={acceptRemaining}
        eventIds={eventIds}
        onClose={acceptDisclosure.onClose}
      />

      <DispositionModal
        open={rejectDisclosure.isOpen}
        decision="Reject"
        inspectionId={inspection.id}
        operationId={operationId}
        isSerial={isSerial}
        units={allocatableUnits}
        maxAllocatable={opRemaining}
        completions={0}
        issueTypes={issueTypes}
        summary={
          failedStatistically
            ? t`Statistical acceptance failed, so the entire lot of ${inspection.lotSize} is considered non-conforming (ISO 9001:2015 §8.7) — ${passes} sampled pass(es) and ${fails} failure(s). Route the units below to scrap or rework, or record the verdict only.`
            : t`The entire lot of ${inspection.lotSize} will be rejected as non-conforming — ${passes} sampled pass(es) and ${fails} failure(s) so far. Route the units below to scrap or rework, or record the verdict only.`
        }
        failedFeatureSummary={failedFeatureSummary}
        eventIds={eventIds}
        onCancel={rejectDisclosure.onClose}
        onSubmit={rejectDisclosure.onClose}
      />

      <DispositionModal
        open={partialDisclosure.isOpen}
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

      <QualityIssueModal
        operationId={operationId}
        trackedEntityId={
          isTracked ? (trackedEntities[0]?.id ?? undefined) : undefined
        }
        isOpen={qualityModal.isOpen}
        onClose={qualityModal.onClose}
      />

      {operation && scrapModal.openCount > 0 && (
        <QuantityModal
          key={`scrap-${scrapModal.openCount}`}
          open={scrapModal.isOpen}
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

      {operation && finishModal.openCount > 0 && (
        <QuantityModal
          key={`finish-${finishModal.openCount}`}
          open={finishModal.isOpen}
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

      {operation && jobId && reworkModal.openCount > 0 && (
        <ReworkModal
          key={`rework-${reworkModal.openCount}`}
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
                disabled={abilityBlocked}
                onClick={() => {
                  actionsSheet.onClose();
                  scrapModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuGitPullRequest className="size-4 shrink-0" />}
                label={t`Rework`}
                disabled={abilityBlocked}
                onClick={() => {
                  actionsSheet.onClose();
                  reworkModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuCheck className="size-4 shrink-0" />}
                label={t`Mark as Done`}
                disabled={abilityBlocked}
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
              {canAddSample && !isLocked ? (
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
      {!abilityBlocked && (
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
      )}
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
  eventIds,
  gridBusy,
  variant = "header"
}: {
  inspectionId: string;
  operationId: string;
  count: number;
  eventIds: ProductionEventIdFields;
  // A reading still saving could turn a passed unit into a failed one.
  gridBusy: boolean;
  variant?: "header" | "bar";
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle" || gridBusy;
  const label = t`Complete (${count} passed)`;

  if (variant === "bar") {
    return (
      <fetcher.Form
        method="post"
        action={path.to.inspectionCompletePassed(inspectionId)}
        className="flex min-w-0 flex-1"
      >
        <input type="hidden" name="operationId" value={operationId} />
        <EventIdInputs eventIds={eventIds} />
        <OriginInput />
        <Button
          type="submit"
          size="lg"
          variant="secondary"
          isDisabled={busy}
          leftIcon={<LuCheckCheck />}
          className="h-12 w-full text-emerald-600 dark:text-emerald-400"
        >
          <span className="truncate">{label}</span>
        </Button>
      </fetcher.Form>
    );
  }

  return (
    <fetcher.Form
      method="post"
      action={path.to.inspectionCompletePassed(inspectionId)}
      className="h-full shrink-0"
    >
      <input type="hidden" name="operationId" value={operationId} />
      <EventIdInputs eventIds={eventIds} />
      <OriginInput />
      <button
        type="submit"
        disabled={busy}
        aria-label={label}
        title={label}
        className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 md:gap-2 md:px-4"
      >
        <LuCheckCheck className="size-4" />
        {/* The label only where the header has room for it; the count
            always. */}
        <span className="hidden tabular-nums xl:inline">{label}</span>
        <span className="tabular-nums xl:hidden">{count}</span>
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
  open,
  onClose
}: {
  inspectionId: string;
  operationId: string;
  fails: number;
  remaining: number;
  eventIds: ProductionEventIdFields;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <AcceptLotBody
          inspectionId={inspectionId}
          operationId={operationId}
          fails={fails}
          remaining={remaining}
          eventIds={eventIds}
          onClose={onClose}
        />
      </ModalContent>
    </Modal>
  );
}

function AcceptLotBody({
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
  const fetcher = useAction<{}>({
    onSettled: () => {
      if (submitted.current) {
        onClose();
        submitted.current = false;
      }
    }
  });
  const submitted = useRef(false);

  return (
    <>
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
          <OriginInput />
          <Button
            type="submit"
            isLoading={fetcher.state !== "idle"}
            isDisabled={fetcher.state !== "idle"}
          >
            <Trans>Accept Lot</Trans>
          </Button>
        </fetcher.Form>
      </ModalFooter>
    </>
  );
}

function ActionSheetButton({
  icon,
  label,
  onClick,
  disabled = false
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 transition-transform active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
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
  const { t } = useLingui();
  const fetcher = useFetcher();
  const startedRef = useRef(false);
  // "submitted" once the auto-start is sent, "announced" once it landed;
  // "done" after the first pause, so a later manual start isn't re-announced.
  const [phase, setPhase] = useState<
    "idle" | "submitted" | "announced" | "done"
  >("idle");

  const busy = fetcher.state !== "idle";
  const running = !!openEvent;
  const workTypeLabel = {
    Setup: t`Setup`,
    Labor: t`Labor`,
    Machine: t`Machine`
  }[workType];

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on open
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (running || busy) return;
    const fd = new FormData();
    fd.set("jobOperationId", operationId);
    fd.set("type", workType);
    fd.set("action", "Start");
    fd.set("exclusive", "true");
    if (workCenterId) fd.set("workCenterId", workCenterId);
    fetcher.submit(fd, { method: "post", action: path.to.productionEvent });
    setPhase("submitted");
  }, []);

  useEffect(() => {
    if (phase === "submitted" && !busy && running) setPhase("announced");
    if (phase === "announced" && !running) setPhase("done");
  }, [phase, busy, running]);

  // The start happens without a press, so say so once it has landed. The
  // region is mounted empty first: a live region announces changes only.
  return (
    <div role="status" className="sr-only">
      {phase === "announced" ? t`${workTypeLabel} timer started` : ""}
    </div>
  );
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
  workType,
  startDisabled = false
}: {
  operationId: string;
  workCenterId?: string;
  openEvent: { id: string; startTime: string } | null;
  workType: WorkType;
  // Starting is refused (ability policy Block); a running timer can still be
  // paused.
  startDisabled?: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const workTypeLabel = {
    Setup: t`Setup`,
    Labor: t`Labor`,
    Machine: t`Machine`
  }[workType];
  const elapsedId = useId();

  // Optimistic state: flip the moment Start/End is submitted instead of
  // waiting for the post-production-event round-trip.
  const pendingAction = fetcher.formData?.get("action");
  const active =
    pendingAction === "Start"
      ? true
      : pendingAction === "End"
        ? false
        : !!openEvent;

  // A disabled button drops focus to the page: when the press settles, put
  // focus back on the button the user pressed.
  const timerButtonRef = useRef<HTMLButtonElement>(null);
  const refocusTimer = useRef(false);
  const isTimerBusy = fetcher.state !== "idle";
  useEffect(() => {
    if (isTimerBusy || !refocusTimer.current) return;
    refocusTimer.current = false;
    if (!document.activeElement || document.activeElement === document.body) {
      timerButtonRef.current?.focus();
    }
  }, [isTimerBusy]);

  const liveElapsed = useElapsed(pendingAction === "End" ? null : openEvent);
  const elapsed = pendingAction === "End" ? 0 : liveElapsed;

  return (
    <fetcher.Form
      method="post"
      action={path.to.productionEvent}
      className="h-full shrink-0"
    >
      <input type="hidden" name="jobOperationId" value={operationId} />
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
        ref={timerButtonRef}
        // Disabled while the press is in flight, so a second press can't post
        // again; the effect above gives focus back once it settles.
        disabled={isTimerBusy || (startDisabled && !openEvent)}
        onClick={() => {
          refocusTimer.current =
            document.activeElement === timerButtonRef.current;
        }}
        type="submit"
        aria-label={
          active
            ? t`Pause ${workTypeLabel} timer`
            : t`Start ${workTypeLabel} timer`
        }
        // The elapsed time, which the label above replaces as the name.
        aria-describedby={elapsedId}
        className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 transition-colors hover:bg-accent active:scale-[0.98] max-md:border-l-0 md:gap-2 md:px-4"
      >
        <span className="flex flex-col items-end leading-none">
          <span id={elapsedId} className="text-sm font-medium tabular-nums">
            {/* The clock moves between the server render and hydration, so the
                elapsed time is only rendered in the browser. */}
            <ClientOnly fallback={formatElapsed(0)}>
              {() => formatElapsed(elapsed)}
            </ClientOnly>
            {/* The running state, read with the elapsed time. */}
            <span className="sr-only">
              {active ? t`, running` : t`, not running`}
            </span>
          </span>
          <span className="text-[0.5625rem] max-md:text-xs uppercase tracking-wider text-muted-foreground">
            {workTypeLabel}
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
