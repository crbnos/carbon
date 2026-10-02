// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useKeepAwake } from "expo-keep-awake";
import { QrCode } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View
} from "react-native";
import { toast } from "sonner-native";
import { ActionDock } from "~/components/ActionDock";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import { StatusBadge } from "~/components/StatusBadge";
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Muted,
  Screen,
  Skeleton,
  WarningNote
} from "~/components/ui";
import { useIsTablet } from "~/components/useIsTablet";
import { useThemeColors } from "~/components/useThemeColor";
import { commandMessage } from "~/features/operations/commands";
import { CameraScanner } from "~/features/scan/CameraScanner";
import { CharacteristicCard } from "./CharacteristicCard";
import {
  useCompletePassed,
  useDisposition,
  useRecordMeasurement,
  useRecordSample,
  useSetGauge
} from "./commands";
import { DispositionSheet } from "./DispositionSheet";
import { DrawingPane } from "./DrawingPane";
import { GaugeSheet } from "./GaugeSheet";
import {
  acceptRemaining,
  buildRows,
  type CellPatch,
  cellKey,
  columnCount,
  completablePassed,
  dispositionGates,
  effectiveMeasurements,
  featureCounts,
  gaugeLabel,
  liveFeatures,
  lotClosed,
  matchUnitByScan,
  maxSampleSize,
  OVERALL_ROW_ID,
  openEntityIds,
  operationRemaining,
  sampleStatuses,
  statusTally,
  unsampledUnits
} from "./logic";
import { UnitStrip } from "./UnitStrip";
import { useInspectionQuery } from "./useInspectionQuery";

/**
 * The inspection screen.
 *
 * **It is a pivot of the web's, not a copy.** Web MES renders
 * characteristics × units as a table beside the drawing. Neither survives the
 * trip: the drawing needs `react-konva` and `react-pdf`, which do not run on
 * React Native, and the table needs forty cells on screen at a size no gloved
 * thumb can hit. So this screen picks ONE unit at a time and lists that unit's
 * characteristics down the page — which is also the order an inspector works
 * in, with one part in hand.
 *
 * What an inspector therefore cannot do here is read the drawing. They record
 * against the characteristic's label and specification, with the drawing on
 * web or on paper beside them.
 *
 * **Per-cell writes do not refetch.** A reading returns its own new status and
 * that is kept locally, so a save costs one request and nothing re-seeds the
 * cells under the inspector's hands. The lot-level writes do refetch, because
 * the server derives quantities from rows this app does not hold.
 */
export function InspectionView({
  operationId,
  onBack
}: {
  operationId: string;
  onBack?: () => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const isTablet = useIsTablet();
  // A tablet clamped to a bench must not sleep between two measurements.
  useKeepAwake();

  const query = useInspectionQuery(operationId);
  const screen = query.data;

  const [selected, setSelected] = useState(0);
  /** Column index -> sample id, for the columns that have one yet. */
  const [idByColumn, setIdByColumn] = useState<Record<number, string>>({});
  /** `sampleId:featureId` -> the reading this screen last wrote. */
  const [cellPatches, setCellPatches] = useState<Record<string, CellPatch>>({});
  /** sampleId -> verdict, for the overall-result row. */
  const [samplePatches, setSamplePatches] = useState<Record<string, string>>(
    {}
  );
  /** featureId -> the gauge this screen last recorded. */
  const [gaugePatches, setGaugePatches] = useState<
    Record<string, string | null>
  >({});
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [gaugeFeatureId, setGaugeFeatureId] = useState<string | null>(null);
  /** Which characteristic the drawing is pointing at, in both directions. */
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  /** featureId -> its card's y offset, so a balloon tap can scroll to it. */
  const cardOffsets = useRef<Record<string, number>>({});

  const scanSheet = useRef<SheetHandle>(null);
  const gaugeSheet = useRef<SheetHandle>(null);
  const closeSheet = useRef<SheetHandle>(null);

  const lot = screen?.inspection;
  const inspectionId = lot?.id ?? "";

  const measurement = useRecordMeasurement(inspectionId);
  const gauge = useSetGauge(inspectionId);
  // The overall-result row writes a verdict per cell, so it must NOT refetch;
  // registering a scanned unit must, because it adds a column.
  const cellSample = useRecordSample(inspectionId, operationId, {
    invalidate: false
  });
  const registerUnit = useRecordSample(inspectionId, operationId);
  const completePassed = useCompletePassed(inspectionId, operationId);
  const disposition = useDisposition(inspectionId, operationId);

  const model = useMemo(() => {
    if (!screen) return null;
    const rows = buildRows(
      screen.features,
      screen.inspection,
      t`Overall result`
    );
    const n = maxSampleSize(screen.features, screen.inspection);
    const total = columnCount({
      isSerial: screen.requiresSerialTracking,
      sampleCount: screen.samples.length,
      lotSize: screen.inspection.lotSize,
      maxSampleSize: n
    });
    const effective = effectiveMeasurements(screen.measurements, cellPatches);
    const counts = featureCounts(screen.features, effective);
    const statuses = sampleStatuses(screen.samples, samplePatches);
    const tally = statusTally(statuses);
    const closed = lotClosed(screen.inspection);
    const gates = dispositionGates({
      closed,
      features: screen.features,
      counts,
      lot: screen.inspection,
      tally
    });
    const open = openEntityIds(screen.trackedEntities, operationId);
    return {
      rows,
      // A balloon's number IS its characteristic's label, so the drawing reads
      // them off the rows rather than the wire carrying them twice.
      labelByFeatureId: new Map(rows.map((row) => [row.featureId, row.label])),
      columns: Array.from({ length: total }, (_, index) => index),
      effective,
      counts,
      statuses,
      tally,
      closed,
      gates,
      openUnits: open,
      hasFeatures: liveFeatures(screen.features).length > 0,
      remaining: operationRemaining(screen.operation),
      acceptRemaining: acceptRemaining({
        isSerial: screen.requiresSerialTracking,
        trackedEntities: screen.trackedEntities,
        samples: screen.samples,
        statuses,
        operationId,
        remaining: operationRemaining(screen.operation)
      }),
      completable: completablePassed({
        isSerial: screen.requiresSerialTracking,
        samples: screen.samples,
        statuses,
        linkedSampleIds: screen.linkedSampleIds,
        openEntityIds: open,
        passes: tally.passes,
        linkedProductionQuantity: screen.linkedProductionQuantity,
        remaining: operationRemaining(screen.operation)
      }),
      unscanned: unsampledUnits(screen.trackedEntities, screen.samples)
    };
  }, [screen, cellPatches, samplePatches, operationId, t]);

  if (query.isPending) {
    return (
      <Screen
        scroll
        title={t`Inspection`}
        onBack={onBack}
        className="gap-3 py-4"
      >
        <Skeleton className="h-28" />
        <Skeleton className="h-14" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </Screen>
    );
  }

  if (query.isError || !screen || !model || !lot) {
    return (
      <Screen
        scroll
        title={t`Inspection`}
        onBack={onBack}
        className="gap-3 py-4"
      >
        <ErrorNote>
          {commandMessage(query.error, t`Could not open this inspection`)}
        </ErrorNote>
        <Button variant="secondary" onPress={() => query.refetch()}>
          {t`Try again`}
        </Button>
      </Screen>
    );
  }

  // The column the strip has selected, and the sample sitting in it. A spare
  // column has none until the first reading creates it server-side.
  const column = Math.min(selected, Math.max(0, model.columns.length - 1));
  const samplesByColumn = model.columns.map((index) => screen.samples[index]);
  const sampleIdFor = (index: number) =>
    screen.samples[index]?.id ?? idByColumn[index];
  const currentSampleId = sampleIdFor(column);
  const currentSample = samplesByColumn[column];

  const cellFor = (featureId: string) => {
    if (featureId === OVERALL_ROW_ID) {
      const status = currentSampleId
        ? model.statuses.get(currentSampleId)
        : undefined;
      return { status, value: null };
    }
    if (!currentSampleId) return { status: undefined, value: null };
    const found = model.effective.get(`${currentSampleId}:${featureId}`);
    return { status: found?.status, value: found?.value ?? null };
  };

  /** Record the save's own result rather than refetching the screen. */
  const keepResult = (
    sampleId: string,
    featureId: string,
    status: string,
    value: number | null
  ) => {
    setIdByColumn((prev) =>
      prev[column] === sampleId ? prev : { ...prev, [column]: sampleId }
    );
    if (featureId === OVERALL_ROW_ID) {
      setSamplePatches((prev) => ({ ...prev, [sampleId]: status }));
      return;
    }
    setCellPatches((prev) => ({
      ...prev,
      [`${sampleId}:${featureId}`]: { status, value }
    }));
  };

  const saveMeasurement = async (
    featureId: string,
    payload: { value?: string; passed?: "true" | "false" }
  ) => {
    const key = cellKey(column, featureId);
    setSavingCell(key);
    try {
      if (featureId === OVERALL_ROW_ID) {
        // No document: the cell IS the unit's verdict, written through the
        // sample endpoint — the one place the two kinds of cell differ.
        const status = payload.passed === "true" ? "Passed" : "Failed";
        const result = await cellSample.mutateAsync({
          sampleId: currentSampleId,
          trackedEntityId: currentSample?.trackedEntityId ?? undefined,
          status
        });
        keepResult(result.sampleId, featureId, status, null);
        return;
      }
      const result = await measurement.mutateAsync({
        sampleId: currentSampleId,
        inspectionFeatureId: featureId,
        ...payload
      });
      keepResult(
        result.sampleId,
        featureId,
        result.measurementStatus,
        payload.value != null && payload.value !== ""
          ? Number(payload.value)
          : null
      );
      if (result.sampleStatus) {
        setSamplePatches((prev) => ({
          ...prev,
          [result.sampleId]: result.sampleStatus
        }));
      }
    } catch (error) {
      toast.error(commandMessage(error, t`Could not save that reading`));
    } finally {
      setSavingCell(null);
    }
  };

  const addUnit = async (trackedEntityId: string) => {
    try {
      await registerUnit.mutateAsync({ trackedEntityId, status: "Pending" });
      scanSheet.current?.close();
      // The new column is appended, so selecting it puts the inspector on the
      // unit they just scanned rather than leaving them on the previous one.
      setSelected(screen.samples.length);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not add that unit`));
    }
  };

  const gaugeRow = model.rows.find((row) => row.featureId === gaugeFeatureId);
  const gaugeValueFor = (featureId: string, stored: string | null) =>
    featureId in gaugePatches ? gaugePatches[featureId] : stored;

  const header = (
    <View className="gap-3 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          {lot.itemReadableId ? (
            <Text className="text-sm text-muted-foreground" numberOfLines={1}>
              {lot.itemReadableId}
            </Text>
          ) : null}
          <Text
            className="text-xl font-semibold leading-tight text-foreground"
            numberOfLines={2}
          >
            {lot.item?.name ?? screen.operation.description ?? t`Inspection`}
          </Text>
        </View>
        <StatusBadge entity="inspection" status={lot.status} />
      </View>

      <Card className="gap-1">
        {/* The plan the lot is judged against — the numbers the accept and
            reject gates below are computed from, so they are not a mystery. */}
        <View className="flex-row flex-wrap gap-x-4 gap-y-1">
          <Muted className="text-sm">{t`Lot ${lot.lotSize}`}</Muted>
          <Muted className="text-sm">{t`Sample ${lot.sampleSize}`}</Muted>
          <Muted className="text-sm">
            {t`Accept ${lot.acceptanceNumber} / reject ${lot.rejectionNumber}`}
          </Muted>
          {lot.aql != null ? (
            <Muted className="text-sm">{t`AQL ${lot.aql}`}</Muted>
          ) : null}
        </View>
        <View className="flex-row gap-4 pt-1">
          <Text className="text-base text-emerald-700 dark:text-emerald-400">
            {t`${model.tally.passes} passed`}
          </Text>
          <Text className="text-base text-red-700 dark:text-red-400">
            {t`${model.tally.fails} failed`}
          </Text>
          <Muted className="text-base">
            {t`${model.remaining} left to make`}
          </Muted>
        </View>
      </Card>

      {model.closed ? (
        <WarningNote>
          {t`This lot was closed as ${lot.status}. Nothing here can be changed.`}
        </WarningNote>
      ) : null}
    </View>
  );

  const body = (
    <View className="gap-3 pb-4">
      {screen.requiresSerialTracking && screen.samples.length === 0 ? (
        <Card>
          <EmptyState
            title={t`No units scanned yet`}
            description={t`Scan a unit to start inspecting it.`}
          />
        </Card>
      ) : (
        model.rows.map((row) => {
          const cell = cellFor(row.featureId);
          const stored = gaugeValueFor(row.featureId, row.gaugeId);
          return (
            <View
              key={row.featureId}
              // Where this card sits, so a balloon tap can scroll to it. The
              // y is relative to the scroll content, which is what
              // `scrollTo` wants.
              onLayout={(event) => {
                cardOffsets.current[row.featureId] = event.nativeEvent.layout.y;
              }}
            >
              <CharacteristicCard
                row={row}
                status={cell.status}
                value={cell.value}
                gaugeLabel={gaugeLabel(
                  screen.gauges.find((g) => g.id === stored)
                )}
                disabled={model.closed}
                saving={savingCell === cellKey(column, row.featureId)}
                recorded={model.counts.get(row.featureId)}
                active={activeFeatureId === row.featureId}
                onActivate={() => setActiveFeatureId(row.featureId)}
                onCommitValue={(value) =>
                  saveMeasurement(row.featureId, { value })
                }
                onToggle={(passed) =>
                  saveMeasurement(row.featureId, { passed })
                }
                onPickGauge={
                  row.gaugeTypeId
                    ? () => {
                        setGaugeFeatureId(row.featureId);
                        gaugeSheet.current?.open();
                      }
                    : undefined
                }
              />
            </View>
          );
        })
      )}
    </View>
  );

  return (
    <View
      className={`flex-1 bg-background ${isTablet ? "flex-row" : "flex-col"}`}
    >
      <View className="flex-1">
        <Screen title={t`Inspection`} onBack={onBack}>
          <ScrollView
            ref={scroller}
            className="flex-1"
            contentContainerClassName="grow"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => query.refetch()}
                tintColor={colors.mutedForeground}
              />
            }
          >
            {header}

            {screen.drawing && screen.drawing.balloons.length > 0 ? (
              <View className="pb-4">
                <DrawingPane
                  inspectionId={inspectionId}
                  balloons={screen.drawing.balloons}
                  labelByFeatureId={model.labelByFeatureId}
                  activeFeatureId={activeFeatureId}
                  onBalloonPress={(featureId) => {
                    setActiveFeatureId(featureId);
                    const y = cardOffsets.current[featureId];
                    // Only scroll to a card that has been laid out; the
                    // highlight lands either way.
                    if (y != null) {
                      scroller.current?.scrollTo({ y, animated: true });
                    }
                  }}
                />
              </View>
            ) : null}

            {!model.closed || screen.samples.length > 0 ? (
              <View className="-mx-4">
                <UnitStrip
                  columns={model.columns}
                  samples={samplesByColumn}
                  statuses={model.statuses}
                  selected={column}
                  onSelect={setSelected}
                  isSerial={screen.requiresSerialTracking}
                  onScan={() => scanSheet.current?.open()}
                  disabled={model.closed}
                />
              </View>
            ) : null}
            {body}
          </ScrollView>
        </Screen>
      </View>

      <ActionDock>
        <Button
          loading={completePassed.isPending}
          disabled={model.closed || model.completable <= 0}
          onPress={async () => {
            try {
              const result = await completePassed.mutateAsync({});
              toast.success(t`Completed ${result.completed}`);
            } catch (error) {
              toast.error(
                commandMessage(error, t`Could not complete those units`)
              );
            }
          }}
        >
          {model.completable > 0
            ? t`Complete passed (${model.completable})`
            : t`Complete passed`}
        </Button>
        <Button
          variant="secondary"
          disabled={
            model.closed || (!model.gates.canAccept && !model.gates.canReject)
          }
          onPress={() => closeSheet.current?.open()}
        >
          {t`Close the lot`}
        </Button>
      </ActionDock>

      <Sheet ref={scanSheet} title={t`Scan a unit`}>
        <View className="gap-3 px-2">
          <CameraScanner
            onScan={async (text) => {
              const unit = matchUnitByScan(model.unscanned, text);
              if (!unit) {
                toast.error(t`That code is not a unit of this lot`);
                return;
              }
              await addUnit(unit.id);
            }}
          />
          {model.unscanned.length > 0 ? (
            <>
              <Muted className="text-sm">{t`Or choose a unit`}</Muted>
              {model.unscanned.map((unit) => (
                <Pressable
                  key={unit.id}
                  onPress={() => addUnit(unit.id)}
                  accessibilityRole="button"
                  className="min-h-[56px] flex-row items-center gap-3 rounded-lg border border-border px-3 active:bg-muted"
                >
                  <QrCode size={20} color={colors.mutedForeground} />
                  <Text className="flex-1 text-base text-foreground">
                    {unit.readableId ?? unit.id}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : (
            <Body className="py-4 text-center text-muted-foreground">
              {t`Every unit of this lot has been scanned.`}
            </Body>
          )}
        </View>
      </Sheet>

      <GaugeSheet
        ref={gaugeSheet}
        gauges={screen.gauges}
        recentGaugeIds={screen.recentGaugeIds}
        gaugeTypeId={gaugeRow?.gaugeTypeId ?? null}
        value={
          gaugeRow
            ? (gaugeValueFor(gaugeRow.featureId, gaugeRow.gaugeId) ?? null)
            : null
        }
        onSelect={async (gaugeId) => {
          if (!gaugeFeatureId) return;
          gaugeSheet.current?.close();
          try {
            await gauge.mutateAsync({
              inspectionFeatureId: gaugeFeatureId,
              gaugeId: gaugeId ?? undefined
            });
            setGaugePatches((prev) => ({ ...prev, [gaugeFeatureId]: gaugeId }));
          } catch (error) {
            toast.error(commandMessage(error, t`Could not record that gauge`));
          }
        }}
      />

      <DispositionSheet
        sheetRef={closeSheet}
        operationId={operationId}
        isSerial={screen.requiresSerialTracking}
        canAccept={model.gates.canAccept}
        canReject={model.gates.canReject}
        acceptRemaining={model.acceptRemaining}
        failedCount={model.tally.fails}
        openUnitCount={model.openUnits.size}
        issueTypes={screen.issueTypes}
        pending={disposition.isPending}
        error={
          disposition.error
            ? commandMessage(disposition.error, t`Could not close the lot`)
            : null
        }
        onSubmit={async (args) => {
          try {
            const result = await disposition.mutateAsync(
              screen.requiresSerialTracking && args.decision === "Reject"
                ? {
                    ...args,
                    // A serial reject condemns every unit still open here.
                    scrapEntityIds: [...model.openUnits]
                  }
                : args
            );
            closeSheet.current?.close();
            // Warnings mean the lot IS closed and the units ARE posted; each
            // names a follow-up that did not land. Retrying would be refused,
            // so they are shown rather than treated as a failure.
            if (result.warnings.length > 0) {
              toast.warning(
                `${result.message} — ${result.warnings.join(", ")}`
              );
            } else {
              toast.success(result.message);
            }
            if (result.finished) onBack?.();
          } catch {
            // The sheet renders `disposition.error` itself; the inspector must
            // stay on it, because a one-shot close is not a thing to lose.
          }
        }}
      />
    </View>
  );
}
