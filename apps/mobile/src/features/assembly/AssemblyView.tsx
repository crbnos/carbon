// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  AssemblyMaterial,
  AssemblyTrackedEntity,
  ProductionEvent
} from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import {
  Ellipsis,
  ListChecks,
  Pause,
  Play,
  TriangleAlert
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import { toast } from "sonner-native";
import { ActionDock } from "~/components/ActionDock";
import { type SheetHandle, SheetRow } from "~/components/BottomSheet";
import { Burst } from "~/components/Burst";
import { HeroButton } from "~/components/HeroButton";
import { TabBar, type TabDef, TabPanel } from "~/components/Tabs";
import {
  Button,
  ErrorNote,
  Muted,
  Screen,
  Skeleton,
  WarningNote
} from "~/components/ui";
import { useIsTablet } from "~/components/useIsTablet";
import { usePullToRefresh } from "~/components/usePullToRefresh";
import { useThemeColors } from "~/components/useThemeColor";
import {
  commandMessage,
  useEndEvent,
  usePrintLabel,
  useReportQuantity,
  useStartEvent
} from "~/features/operations/commands";
import { FinishDialog } from "~/features/operations/FinishDialog";
import { IssueSheet, type IssueTarget } from "~/features/operations/IssueSheet";
import {
  availableWorkTypes,
  consumedForMaterial,
  eventIdsFrom,
  openEvents as findOpenEvents,
  matchMaterialToScan,
  type OpenEvents,
  type ReportTarget,
  trackingFields,
  WORK_TYPES,
  type WorkType
} from "~/features/operations/logic";
import { MoreActionsSheet } from "~/features/operations/MoreActionsSheet";
import { NotesTab } from "~/features/operations/NotesTab";
import { QualityIssueSheet } from "~/features/operations/QualityIssueSheet";
import {
  QuantitySheet,
  ReworkSheet,
  ScrapSheet
} from "~/features/operations/ReportSheets";
import { formatElapsed, useTimer } from "~/features/operations/useTimer";
import { WorkTypeToggle } from "~/features/operations/WorkTypeToggle";
import { useKeyboardWedge } from "~/features/scan/useKeyboardWedge";
import { ApiClientError } from "~/lib/api/errors";
import { useAuth } from "~/lib/auth/AuthProvider";
import { backOrBoard } from "~/lib/navigation/backOrBoard";
import { AssemblyDetails } from "./AssemblyDetails";
import {
  completedUnits,
  containmentWithoutStep,
  unitCount as countUnits,
  deriveUnits,
  firstIncompleteStep,
  isUnitBuilt,
  type MaterialState,
  materialStates,
  maxNavigableUnitIndex,
  nextIncompleteUnit,
  pendingScans,
  resolveUnitIndex,
  shouldAutoCompleteUnit,
  sortSteps,
  stepTools,
  unissuedTrackedParts,
  unitHasBadResult,
  unitIsRecorded,
  unitRemainingToIssue
} from "./logic";
import { ModelPane } from "./ModelPane";
import { PartsList, ToolsList } from "./PartsList";
import { StepCard, StepsBar } from "./StepPanel";
import { UnitPager, type UnitRow, UnitSheet } from "./UnitPager";
import { type UnitSelection, useAssemblyQuery } from "./useAssemblyQuery";

type Tab = "build" | "model" | "details" | "notes";

/**
 * The assembly screen: web MES's assembly view, for a phone and a tablet.
 *
 * Web lays it out in three columns — units and progress on the left, the step
 * in the middle, parts and tools on the right — with its timers in the header.
 * A phone has one column, so the same things are stacked in the order an
 * assembler uses them: which unit, which step, what goes in, and the timer and
 * Complete within a thumb's reach at the bottom. On a tablet the step and its
 * parts sit side by side again and the dock becomes the right-hand column.
 *
 * Every rule it decides by — which unit, whether a step is done, what a part
 * still needs, when a unit completes itself — is in `logic.ts`, ported from
 * web's and tested there. This file arranges them and wires the commands.
 *
 * Three things happen without a tap, as they do on the web:
 *
 *  - recording a step moves to the next one, and the first one recorded
 *    starts the Labor timer (ending an open Setup);
 *  - recording the last step stops Labor;
 *  - on an operation that builds more than one, recording the last step of
 *    the unit being built completes that unit and moves to the next.
 *
 * None of them can fire on an operation with no steps, which is completed by
 * hand.
 */
export function AssemblyView({
  operationId,
  onBack
}: {
  operationId: string;
  onBack?: () => void;
}) {
  const { t } = useLingui();
  const isTablet = useIsTablet();
  const colors = useThemeColors();
  const { me, operator } = useAuth();
  useKeepAwake();

  // Whose records may be undone: the pinned operator on a shared tablet.
  const userId = operator?.userId ?? me?.user.id ?? null;

  const [selection, setSelection] = useState<UnitSelection>(null);
  // Bumped on each completed unit; `Burst` re-rolls and replays from it.
  const [burstCount, setBurst] = useState(0);
  const query = useAssemblyQuery(operationId, selection);
  const screen = query.data;
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);

  const [tab, setTab] = useState<Tab>("build");
  const playback = screen?.assemblyPlayback ?? null;
  const [stepIndex, setStepIndex] = useState(0);
  const [workType, setWorkType] = useState<WorkType | null>(null);
  const [finishing, setFinishing] = useState(false);
  // The material being issued, by id. Its numbers are read from the live
  // `states` every render, never kept from the moment the sheet opened: the
  // sheet stays open through a Remove, and a snapshot went on saying "1 of 1
  // issued" after the part had been taken back out.
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const quantitySheet = useRef<SheetHandle>(null);
  const scrapSheet = useRef<SheetHandle>(null);
  const reworkSheet = useRef<SheetHandle>(null);
  const moreSheet = useRef<SheetHandle>(null);
  const qualitySheet = useRef<SheetHandle>(null);
  const unitSheet = useRef<SheetHandle>(null);

  const start = useStartEvent(operationId);
  const end = useEndEvent(operationId);
  const report = useReportQuantity(operationId);
  const print = usePrintLabel();

  // ── Everything the screen derives, in one place ────────────────────────
  const model = useMemo(() => {
    if (!screen) return null;
    const { operation } = screen;
    const serial = screen.requiresSerialTracking;
    const batch = screen.requiresBatchTracking;
    const isTracked = serial || batch;
    const axisEntities: AssemblyTrackedEntity[] = isTracked
      ? screen.trackedEntities
      : [];
    const count = countUnits(
      operation.operationQuantity,
      screen.trackedEntities.length
    );
    const units = deriveUnits(count, axisEntities);
    const quantityComplete = completedUnits(operation.quantityComplete);
    const unitIndex = resolveUnitIndex({
      units,
      navigatesByEntity: serial,
      trackedEntityId:
        selection && "trackedEntityId" in selection
          ? selection.trackedEntityId
          : screen.trackedEntityId,
      unitParam: selection && "unit" in selection ? selection.unit : null,
      quantityComplete
    });
    // A batch parent shares one lot across every unit.
    const entity = batch
      ? (axisEntities[0] ?? null)
      : (units[unitIndex]?.entity ?? null);
    const steps = sortSteps(screen.procedure.attributes);
    return {
      operation,
      serial,
      batch,
      isTracked,
      units,
      count,
      quantityComplete,
      unitIndex,
      entity,
      steps,
      maxUnit: maxNavigableUnitIndex(units, serial)
    };
  }, [screen, selection]);

  const steps = model?.steps ?? [];
  const unitIndex = model?.unitIndex ?? 0;
  const currentStep = Math.max(
    0,
    Math.min(stepIndex, Math.max(0, steps.length - 1))
  );
  const step = steps[currentStep] ?? null;
  const allStepsRecorded = unitIsRecorded(steps, unitIndex);

  const states = useMemo(
    () =>
      screen && model
        ? materialStates({
            materials: screen.materials.materials,
            steps,
            stepIndex: currentStep,
            unitIndex,
            parentIsTracked: model.isTracked
          })
        : [],
    [screen, model, steps, currentStep, unitIndex]
  );
  const issuing: MaterialState<AssemblyMaterial> | null =
    issuingId === null
      ? null
      : (states.find((state) => state.material.id === issuingId) ?? null);
  const gatedBy = pendingScans(states).map(
    (state) =>
      state.material.description ?? state.material.itemReadableId ?? "?"
  );

  // Labor reads the operator's OWN open event first: `events` is everyone's,
  // and on a line with two assemblers the first open Labor in the list is not
  // necessarily theirs. The other kinds follow web, which reads `events`.
  const open = useMemo<OpenEvents>(() => {
    if (!screen) return {};
    const found = findOpenEvents(screen.events);
    const own: ProductionEvent | undefined = screen.openEvent
      ? (screen.events.find((event) => event.id === screen.openEvent?.id) ?? {
          id: screen.openEvent.id,
          type: "Labor",
          startTime: screen.openEvent.startTime
        })
      : undefined;
    return { ...found, Labor: own ?? found.Labor };
  }, [screen]);

  const types = useMemo(
    () =>
      screen ? availableWorkTypes(screen.operation) : (["Labor"] as WorkType[]),
    [screen]
  );
  const activeType: WorkType =
    workType ?? WORK_TYPES.find((type) => open[type]) ?? types[0] ?? "Labor";
  const runningEvent = open[activeType];
  const workTypeLabels: Record<WorkType, string> = {
    Setup: t`Setup`,
    Labor: t`Labor`,
    Machine: t`Machine`
  };
  const elapsed = useTimer(runningEvent);

  const target: ReportTarget | null = model
    ? {
        operationId,
        operationQuantity: model.operation.operationQuantity,
        quantityComplete: model.operation.quantityComplete,
        trackedEntityId: model.isTracked ? model.entity?.id : undefined,
        trackedEntityReadableId: model.entity?.readableId ?? null,
        trackingType: model.serial
          ? "Serial"
          : model.batch
            ? "Batch"
            : undefined
      }
    : null;

  const blockedReason = (() => {
    const workCenter = screen?.workCenter;
    if (!workCenter?.isBlocked) return undefined;
    return workCenter.blockingDispatchReadableId
      ? t`${workCenter.name} is blocked by maintenance ${workCenter.blockingDispatchReadableId}.`
      : t`${workCenter.name} is blocked for maintenance.`;
  })();
  const locked = Boolean(blockedReason);
  // Between units the payload on screen still belongs to the last one.
  const switching = query.isPlaceholderData;

  // ── Navigation between units ───────────────────────────────────────────
  const goToUnit = (index: number) => {
    if (!model) return;
    const clamped = Math.max(0, Math.min(index, model.maxUnit));
    if (clamped === model.unitIndex) return;
    const entity = model.units[clamped]?.entity;
    setSelection(
      model.serial && entity
        ? { trackedEntityId: entity.id }
        : { unit: clamped }
    );
  };

  // After a unit is complete: the next one still to build. A serial parent on
  // its FIRST operation is handed it (its label prints as it completes); on a
  // later operation every unit already carries a label, so the operator picks
  // the one they hold. Everything else rolls forward on `quantityComplete`,
  // which is where the server lands when no unit is asked for.
  const afterUnitComplete = () => {
    if (!screen) return;
    // The one celebratory moment in the app. A unit finished is the thing
    // an assembler is actually here to do, and it is rare enough — minutes
    // or hours apart — that marking it does not become wallpaper. The
    // burst never blocks: it is absolutely positioned and
    // `pointerEvents="none"`, so the next unit can be started through it.
    setBurst((n) => n + 1);
    if (screen.requiresSerialTracking && !screen.isFirstOperation) {
      setSelection(null);
      unitSheet.current?.open();
      return;
    }
    setSelection(null);
  };

  // ── Wrong screen: the operation belongs on another view ────────────────
  const wrongView =
    query.error instanceof ApiClientError
      ? (query.error.details as { view?: string } | undefined)?.view
      : undefined;
  useEffect(() => {
    if (wrongView === "operation") {
      router.replace(`/(app)/operation/${operationId}`);
    } else if (wrongView === "inspection") {
      router.replace(`/(app)/inspection/${operationId}`);
    }
  }, [wrongView, operationId]);

  // ── Step cursor ────────────────────────────────────────────────────────
  // On first open, land on the first step this unit has not recorded; on a
  // unit change, do the same for the new unit.
  const initialStepResolved = useRef(false);
  const lastUnit = useRef<number | null>(null);
  useEffect(() => {
    if (!model || steps.length === 0) return;
    const firstOpen = firstIncompleteStep(steps, unitIndex);
    if (!initialStepResolved.current) {
      initialStepResolved.current = true;
      lastUnit.current = unitIndex;
      setStepIndex(firstOpen >= 0 ? firstOpen : 0);
      return;
    }
    if (lastUnit.current !== unitIndex) {
      lastUnit.current = unitIndex;
      setStepIndex(firstOpen >= 0 ? firstOpen : 0);
    }
  }, [model, steps, unitIndex]);

  // ── Recording the step on screen moves on, and starts Labor ────────────
  const stepDone = useRef<{ step: number; unit: number; done: boolean }>({
    step: -1,
    unit: -1,
    done: false
  });
  const currentDone = step
    ? (step.jobOperationStepRecord ?? []).some((r) => r.index === unitIndex)
    : false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: transition-detect on the current step only, as web's
  useEffect(() => {
    const previous = stepDone.current;
    stepDone.current = {
      step: currentStep,
      unit: unitIndex,
      done: currentDone
    };
    const justCompleted =
      previous.step === currentStep &&
      previous.unit === unitIndex &&
      !previous.done &&
      currentDone;
    if (!justCompleted || !screen || !model) return;

    if (!open.Labor && !allStepsRecorded && !start.isPending) {
      start
        .mutateAsync({
          type: "Labor",
          // Hands-on build has begun: end an open Setup and switch to Labor.
          exclusive: true,
          workCenterId: screen.operation.workCenterId ?? undefined,
          trackedEntityId: model.isTracked ? model.entity?.id : undefined,
          unitIndex
        })
        .catch((error) =>
          toast.error(commandMessage(error, t`Could not start the timer`))
        );
    }
    if (currentStep < steps.length - 1) setStepIndex(currentStep + 1);
  }, [currentStep, currentDone, unitIndex]);

  // ── The last step stops Labor; on a multi-unit build it completes the unit
  const allDone = useRef<{ unit: number; done: boolean }>({
    unit: -1,
    done: false
  });
  const completing = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: transition-detect on the unit's all-recorded flag, as web's
  useEffect(() => {
    const previous = allDone.current;
    allDone.current = { unit: unitIndex, done: allStepsRecorded };
    if (!screen || !model || !target) return;
    if (previous.unit !== unitIndex) return;
    if (previous.done || !allStepsRecorded) return;

    const eventIds = eventIdsFrom(open);
    const labor = open.Labor;
    const run = async () => {
      if (labor) {
        await end
          .mutateAsync({ eventId: labor.id })
          .catch((error) =>
            toast.error(commandMessage(error, t`Could not stop the timer`))
          );
      }
      if (
        completing.current ||
        !shouldAutoCompleteUnit({
          unitCount: model.count,
          quantityComplete: model.quantityComplete,
          unitIndex,
          allStepsRecorded: true,
          navigatesByEntity: model.serial,
          entity: model.entity,
          operationId
        })
      ) {
        return;
      }
      completing.current = true;
      try {
        const result = await report.mutateAsync({
          quantity: 1,
          ...trackingFields(target),
          ...eventIds
        });
        if (result.finished) {
          toast.success(t`All units built — this operation is finished`);
          (onBack ?? backOrBoard)();
          return;
        }
        toast.success(t`Unit ${unitIndex + 1} complete`);
        afterUnitComplete();
      } catch (error) {
        toast.error(commandMessage(error, t`Could not complete the unit`));
      } finally {
        completing.current = false;
      }
    };
    void run();
  }, [allStepsRecorded, unitIndex]);

  // ── A company that asks for it: start the timer when the screen opens ──
  const autoStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot when the screen first has data, as web's AutoTimer
  useEffect(() => {
    if (!screen || !model || autoStarted.current) return;
    autoStarted.current = true;
    // Web starts nothing on an operation that plans no time: there is nothing
    // to track, and a stray Labor event helps no one.
    const hasPlannedTime =
      (screen.operation.setupDuration ?? 0) > 0 ||
      (screen.operation.laborDuration ?? 0) > 0 ||
      (screen.operation.machineDuration ?? 0) > 0;
    if (!screen.autoStartOperationTimer || !hasPlannedTime) return;
    const first = types[0] ?? "Labor";
    if (open[first]) return;
    start
      .mutateAsync({
        type: first,
        exclusive: true,
        workCenterId: screen.operation.workCenterId ?? undefined,
        trackedEntityId: model.isTracked ? model.entity?.id : undefined,
        unitIndex
      })
      .catch((error) =>
        toast.error(commandMessage(error, t`Could not start the timer`))
      );
  }, [screen, model]);

  // ── A later operation: ask which unit is in the operator's hands ───────
  const arrivalPrompted = useRef(false);
  useEffect(() => {
    if (!screen || !model || arrivalPrompted.current) return;
    if (!model.serial || screen.isFirstOperation) return;
    arrivalPrompted.current = true;
    if (nextIncompleteUnit(model.units, operationId)) {
      unitSheet.current?.open();
    }
  }, [screen, model, operationId]);

  // ── A hardware scanner: a part's label opens that part ─────────────────
  const anySheetOpen = issuingId !== null || finishing;
  const wedge = useKeyboardWedge({
    enabled: tab === "build" && !anySheetOpen && Boolean(screen),
    onScan: (code) => {
      if (!screen) return;
      const match = matchMaterialToScan(screen.materials.materials, code);
      const state = match
        ? states.find((candidate) => candidate.material.id === match.id)
        : undefined;
      if (state?.material.id) {
        setIssuingId(state.material.id);
        return;
      }
      toast.error(
        match
          ? t`${code} is not used on this step`
          : t`${code} is not a part of this assembly`
      );
    }
  });

  // ── Early returns, after every hook ────────────────────────────────────
  if (
    query.isLoading ||
    wrongView === "operation" ||
    wrongView === "inspection"
  ) {
    return (
      <Screen className="gap-4 py-4" title={t`Assembly`} onBack={onBack}>
        <Skeleton className="h-16" />
        <Skeleton className="h-14" />
        <Skeleton className="h-48" />
        <Skeleton className="h-24" />
      </Screen>
    );
  }

  if (query.isError || !screen || !model || !target) {
    return (
      <Screen className="gap-4 py-4" title={t`Assembly`} onBack={onBack}>
        <ErrorNote>
          {commandMessage(query.error, t`Could not open this assembly`)}
        </ErrorNote>
        <Button variant="secondary" onPress={() => query.refetch()}>
          {t`Try again`}
        </Button>
      </Screen>
    );
  }

  const { operation, job } = screen;
  const tools = stepTools(screen.tools, step);
  const missingContainment = containmentWithoutStep(
    screen.nonConformanceActions,
    screen.procedure.attributes
  );
  const doneCount = steps.filter((s) =>
    (s.jobOperationStepRecord ?? []).some((r) => r.index === unitIndex)
  ).length;
  const unissued = unissuedTrackedParts({
    materials: screen.materials.materials,
    unitIndex,
    parentIsTracked: model.isTracked
  });
  const unitRows: UnitRow[] = model.units.map((unit) => ({
    unit,
    built: isUnitBuilt({
      navigatesByEntity: model.serial,
      entity: unit.entity,
      unitIndex: unit.index,
      quantityComplete: model.quantityComplete,
      operationId
    }),
    bad: unitHasBadResult(steps, unit.index),
    locked: unit.index > model.maxUnit
  }));
  const trackingLabel = model.serial ? t`S/N` : model.batch ? t`Batch` : null;
  const eventIds = eventIdsFrom(open);

  const issueTarget: IssueTarget | null = issuing
    ? {
        operationId,
        material: issuing.material,
        required: issuing.required,
        issued: issuing.issued,
        suggested: unitRemainingToIssue(issuing),
        // An untracked parent has no unit entity, but a tracked part still
        // needs a genealogy parent: web falls back to the make method's seed
        // entity, and so does this.
        parentEntityId: model.entity?.id ?? screen.trackedEntities[0]?.id,
        jobOperationStepId: step?.id,
        unitNumber: unitIndex + 1,
        expiredEntityPolicy: screen.expiredEntityPolicy,
        consumed: consumedForMaterial(
          screen.materials.trackedInputs,
          issuing.material.id
        )
      }
    : null;

  const toggleTimer = async () => {
    try {
      if (runningEvent) {
        await end.mutateAsync({ eventId: runningEvent.id });
      } else {
        await start.mutateAsync({
          type: activeType,
          // Single-phase clocking, as web's assembly header: starting one kind
          // of time ends any other that is open.
          exclusive: true,
          workCenterId: operation.workCenterId ?? undefined,
          trackedEntityId: model.isTracked ? model.entity?.id : undefined,
          unitIndex
        });
      }
    } catch (error) {
      toast.error(
        commandMessage(
          error,
          runningEvent ? t`Could not pause` : t`Could not start`
        )
      );
    }
  };

  const tabs: TabDef<Tab>[] = [
    {
      value: "build",
      label: t`Build`,
      badge: steps.length ? `${doneCount}/${steps.length}` : undefined
    },
    // Only when the instruction actually has a converted model: an empty 3D
    // tab tells an operator nothing and costs them a tap to find that out.
    ...(playback ? [{ value: "model" as const, label: t`3D` }] : []),
    { value: "details", label: t`Details` },
    { value: "notes", label: t`Notes` }
  ];

  const stepPanel = (
    <View className="gap-3">
      {missingContainment.length ? (
        <View className="flex-row items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
          <TriangleAlert size={18} color="#ef4444" />
          <Text className="flex-1 text-sm text-foreground">
            {missingContainment.length === 1
              ? t`An open containment action needs signing off on this operation. Open it in Carbon MES on the web.`
              : t`${missingContainment.length} open containment actions need signing off on this operation. Open it in Carbon MES on the web.`}
          </Text>
        </View>
      ) : null}
      {step ? (
        <>
          <StepsBar
            steps={steps}
            unitIndex={unitIndex}
            current={currentStep}
            onSelect={setStepIndex}
          />
          <StepCard
            operationId={operationId}
            step={step}
            index={currentStep}
            total={steps.length}
            unitIndex={unitIndex}
            userId={userId}
            gatedBy={gatedBy}
            busy={switching || locked}
            onPrevious={() => setStepIndex(Math.max(0, currentStep - 1))}
            onNext={() =>
              setStepIndex(Math.min(steps.length - 1, currentStep + 1))
            }
          />
        </>
      ) : (
        <Muted className="text-sm">
          {t`No steps defined for this operation. Issue the parts, then complete the unit.`}
        </Muted>
      )}
    </View>
  );

  const partsPanel = (
    <View className="gap-4">
      <PartsList
        states={states}
        currentStepNumber={step ? currentStep + 1 : null}
        onIssue={(state) => {
          if (switching || !state.material.id) return;
          setIssuingId(state.material.id);
        }}
      />
      <ToolsList tools={tools} />
    </View>
  );

  return (
    <View
      className={`flex-1 bg-background ${isTablet ? "flex-row" : "flex-col"}`}
    >
      {/* A scanner's keystrokes land here; see `useKeyboardWedge`. */}
      <TextInput ref={wedge.ref} {...wedge.props} />
      <View className="flex-1">
        <Screen
          title={
            job.itemReadableIdWithRevision ??
            operation.itemReadableId ??
            t`Assembly`
          }
          onBack={onBack}
          className="px-0"
        >
          <View className="gap-3 px-4 pb-3 pt-3">
            <View className="gap-0.5">
              <Text
                className="text-lg font-semibold leading-tight text-foreground"
                numberOfLines={2}
              >
                {operation.itemDescription ?? job.name ?? operation.description}
              </Text>
              <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                {[operation.description, job.jobId, job.customer?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <UnitPager
              index={unitIndex}
              count={model.count}
              built={model.quantityComplete}
              entity={model.entity}
              trackingLabel={trackingLabel}
              bad={unitHasBadResult(steps, unitIndex)}
              canPrevious={unitIndex > 0}
              canNext={unitIndex < model.maxUnit}
              loading={switching}
              onPrevious={() => goToUnit(unitIndex - 1)}
              onNext={() => goToUnit(unitIndex + 1)}
              onOpenList={() => unitSheet.current?.open()}
            />
            {blockedReason ? <WarningNote>{blockedReason}</WarningNote> : null}
          </View>

          <TabBar tabs={tabs} value={tab} onChange={setTab} />

          <TabPanel active={tab === "build"}>
            <ScrollView
              className="flex-1"
              contentContainerClassName="gap-4 px-4 pb-8 pt-3"
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
              keyboardShouldPersistTaps="handled"
            >
              {isTablet ? (
                <View className="flex-row items-start gap-4">
                  <View className="flex-1">{stepPanel}</View>
                  <View className="w-[340px]">{partsPanel}</View>
                </View>
              ) : (
                <>
                  {stepPanel}
                  {partsPanel}
                </>
              )}
            </ScrollView>
          </TabPanel>
          <TabPanel active={tab === "model"}>
            {playback ? (
              <ModelPane
                operationId={operationId}
                playback={playback}
                instructionStepId={step?.assemblyInstructionStepId}
                stepIndex={currentStep}
                active={tab === "model"}
              />
            ) : null}
          </TabPanel>
          <TabPanel active={tab === "details"}>
            <AssemblyDetails screen={screen} openEvents={open} />
          </TabPanel>
          <TabPanel active={tab === "notes"}>
            <NotesTab operationId={operationId} />
          </TabPanel>
        </Screen>
      </View>

      <ActionDock
        drawer={
          <WorkTypeToggle
            types={[...types]}
            value={activeType}
            open={open}
            onChange={setWorkType}
          />
        }
      >
        <HeroButton
          icon={runningEvent ? Pause : Play}
          // The running clock IS the pause button, as on web's assembly
          // header: the time an operator has been at it, and the way to stop.
          // It names the kind of time, because Start opens the first one the
          // operation plans — Setup here — and an operator expecting Labor
          // must not find that out from their hours.
          label={
            runningEvent && elapsed !== null
              ? `${workTypeLabels[activeType]} ${formatElapsed(elapsed)}`
              : t`Start ${workTypeLabels[activeType]}`
          }
          accessibilityLabel={
            runningEvent
              ? t`Pause ${workTypeLabels[activeType]}`
              : t`Start ${workTypeLabels[activeType]}`
          }
          tone={runningEvent ? "stop" : "start"}
          onPress={toggleTimer}
          disabled={locked}
          loading={start.isPending || end.isPending}
          disabledReason={blockedReason}
        />
        <Button
          variant="secondary"
          onPress={() => quantitySheet.current?.open()}
          disabled={locked || switching}
          className={isTablet ? undefined : "min-h-[56px] rounded-xl px-4"}
        >
          {t`Complete`}
        </Button>
        {isTablet ? (
          <Button
            variant="ghost"
            onPress={() => moreSheet.current?.open()}
            accessibilityLabel={t`More actions`}
          >
            {t`More`}
          </Button>
        ) : (
          <Pressable
            onPress={() => moreSheet.current?.open()}
            accessibilityRole="button"
            accessibilityLabel={t`More actions`}
            className="size-14 items-center justify-center rounded-xl border border-border bg-secondary active:opacity-70"
          >
            <Ellipsis size={24} color={colors.foreground} />
          </Pressable>
        )}
      </ActionDock>

      <UnitSheet
        ref={unitSheet}
        rows={unitRows}
        currentIndex={unitIndex}
        trackingLabel={trackingLabel}
        scannable={model.serial}
        onChoose={(index) => {
          unitSheet.current?.close();
          goToUnit(index);
        }}
      />
      <QuantitySheet
        ref={quantitySheet}
        target={target}
        eventIds={eventIds}
        unissuedTracked={unissued.length > 0}
        onClose={() => quantitySheet.current?.close()}
        onReported={({ finished }) => {
          if (finished) {
            (onBack ?? backOrBoard)();
            return;
          }
          afterUnitComplete();
        }}
      />
      <ScrapSheet
        ref={scrapSheet}
        target={target}
        eventIds={eventIds}
        onClose={() => scrapSheet.current?.close()}
        onReplacementEntity={(id) => setSelection({ trackedEntityId: id })}
      />
      <ReworkSheet
        ref={reworkSheet}
        target={target}
        eventIds={eventIds}
        onClose={() => reworkSheet.current?.close()}
      />
      <MoreActionsSheet
        ref={moreSheet}
        disabledReason={blockedReason}
        printing={print.isPending}
        printDisabledReason={
          model.isTracked && model.entity
            ? undefined
            : t`Only a serial or batch unit has a label to print.`
        }
        onQualityIssue={() => {
          moreSheet.current?.close();
          qualitySheet.current?.open();
        }}
        onPrint={async () => {
          moreSheet.current?.close();
          if (!model.entity) return;
          try {
            // The unit's own serial or lot label, as web's assembly prints.
            await print.mutateAsync({
              sourceDocument: "Entity",
              sourceDocumentId: model.entity.id,
              workCenterId: operation.workCenterId ?? undefined
            });
            toast.success(t`Sent to the printer`);
          } catch (error) {
            toast.error(commandMessage(error, t`Could not print that label`));
          }
        }}
        onScrap={() => {
          moreSheet.current?.close();
          scrapSheet.current?.open();
        }}
        onRework={() => {
          moreSheet.current?.close();
          reworkSheet.current?.open();
        }}
        onFinish={() => {
          moreSheet.current?.close();
          setFinishing(true);
        }}
      >
        {screen.canOverrideComplete &&
        steps.length > 0 &&
        doneCount < steps.length ? (
          <SheetRow
            icon={ListChecks}
            label={t`Complete all steps`}
            disabled
            disabledReason={t`Use Carbon MES in a browser for this.`}
          />
        ) : null}
      </MoreActionsSheet>
      <QualityIssueSheet
        ref={qualitySheet}
        target={target}
        onClose={() => qualitySheet.current?.close()}
      />
      <FinishDialog
        open={finishing}
        target={target}
        openEvents={open}
        onClose={() => setFinishing(false)}
        onFinished={() => (onBack ?? backOrBoard)()}
      />
      {issueTarget ? (
        <IssueSheet target={issueTarget} onClose={() => setIssuingId(null)} />
      ) : null}
      {/*
        Last child, so it paints over the screen rather than under the dock,
        and outside every sheet so a sheet opening on completion does not
        clip it. It catches no touches.
      */}
      <Burst trigger={burstCount} />
    </View>
  );
}
