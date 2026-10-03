// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Square, SquareCheck } from "lucide-react-native";
import { forwardRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { toast } from "sonner-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import {
  Body,
  Button,
  ErrorNote,
  Field,
  Muted,
  Skeleton
} from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import {
  commandMessage,
  useReportQuantity,
  useReportRework,
  useReportScrap
} from "./commands";
import {
  type EventIds,
  needsUnit,
  parseQuantity,
  type ReportTarget,
  remainingQuantity,
  trackingFields
} from "./logic";
import { QuantityInput } from "./QuantityInput";
import { useReworkTargets, useScrapReasons } from "./useLookups";

/**
 * Report good, scrap and rework.
 *
 * All three share one shape, and one rule that matters more than the shape:
 * **the operator stays on the operation.** A success is a toast and a closed
 * sheet; a failure is a toast carrying the SERVER's message — a rule that
 * refused the quantity, a job that is not released — and the sheet stays open
 * with what they typed still in it, so nothing has to be re-entered.
 *
 * The open event ids ride along on every report. That is how the server knows
 * which timers this quantity belongs to, and it is what lets a single tap on
 * "Log completed" both record the quantity and close the operator's time.
 */

type SheetProps = {
  target: ReportTarget;
  eventIds: EventIds;
  onClose: () => void;
};

/**
 * A serial part is reported ONE unit at a time: the quantity is not a choice,
 * so it is shown as the unit it is rather than as a field to get wrong. Web's
 * `QuantityModal` makes the same field read-only.
 */
function SerialUnit({ target }: { target: ReportTarget }) {
  const { t } = useLingui();
  return (
    <View className="gap-1 rounded-lg border border-border bg-card p-4">
      <Muted className="text-sm">{t`One unit`}</Muted>
      <Body className="text-xl font-semibold">
        {target.trackedEntityReadableId ??
          (target.trackedEntityId ? t`The selected unit` : t`No unit selected`)}
      </Body>
    </View>
  );
}

type ScrapSheetProps = SheetProps & {
  /**
   * Scrapping a serial-tracked unit makes the server mint its REPLACEMENT, and
   * that is the unit the operator carries on with. Without this the screen
   * would stay pointed at the serial that was just thrown away, and the next
   * quantity reported would be attributed to it.
   */
  onReplacementEntity: (trackedEntityId: string) => void;
};

type QuantitySheetProps = SheetProps & {
  /**
   * Tracked parts this unit has not been issued in full. Completing anyway is
   * allowed — the web allows it — but it leaves a hole in the genealogy, so
   * the operator has to say they mean it.
   */
  unissuedTracked?: boolean;
  /** Runs after a successful report, with what the server said happened. */
  onReported?: (result: { finished: boolean }) => void;
};

export const QuantitySheet = forwardRef<SheetHandle, QuantitySheetProps>(
  function QuantitySheet(
    { target, eventIds, onClose, unissuedTracked = false, onReported },
    ref
  ) {
    const { t } = useLingui();
    const colors = useThemeColors();
    const [quantity, setQuantity] = useState("1");
    const [notes, setNotes] = useState("");
    const [confirmedUnissued, setConfirmedUnissued] = useState(false);
    const report = useReportQuantity(target.operationId);
    const serial = target.trackingType === "Serial";
    const value = serial ? 1 : parseQuantity(quantity);
    const blocked =
      needsUnit(target) || (unissuedTracked && !confirmedUnissued);

    const submit = async () => {
      if (!value) return;
      try {
        const result = await report.mutateAsync({
          quantity: value,
          notes: notes || undefined,
          ...trackingFields(target),
          ...eventIds
        });
        onClose();
        setQuantity("1");
        setNotes("");
        setConfirmedUnissued(false);
        toast.success(
          result.finished
            ? t`Logged — this operation is finished`
            : t`Logged ${value} completed`
        );
        onReported?.({ finished: result.finished });
      } catch (error) {
        toast.error(commandMessage(error, t`Could not log the quantity`));
      }
    };

    return (
      <Sheet ref={ref} title={t`Log completed`}>
        <View className="gap-4 px-2 pt-2">
          {unissuedTracked ? (
            <Pressable
              onPress={() => setConfirmedUnissued(!confirmedUnissued)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmedUnissued }}
              className="gap-2 rounded-lg border border-red-500 bg-red-500/10 p-3 active:opacity-80"
            >
              <Body className="font-semibold">
                {t`Unissued serial or batch parts`}
              </Body>
              <Muted className="text-sm">
                {t`Tracked parts on this unit have not been fully issued. Completing without them leaves its traceability record incomplete.`}
              </Muted>
              <View className="flex-row items-center gap-3 pt-1">
                {confirmedUnissued ? (
                  <SquareCheck size={24} color={colors.foreground} />
                ) : (
                  <Square size={24} color={colors.mutedForeground} />
                )}
                <Body className="flex-1 text-sm">
                  {t`I understand and want to complete without issuing`}
                </Body>
              </View>
            </Pressable>
          ) : null}
          {serial ? (
            <SerialUnit target={target} />
          ) : (
            <QuantityInput
              label={t`How many are finished?`}
              value={quantity}
              onChange={setQuantity}
              max={remainingQuantity(target)}
            />
          )}
          <Field
            label={t`Note (optional)`}
            value={notes}
            onChangeText={setNotes}
            placeholder={t`Anything the next person should know`}
            multiline
          />
          <Button
            onPress={submit}
            disabled={!value || blocked}
            loading={report.isPending}
          >
            {needsUnit(target)
              ? t`Choose the unit first`
              : value
                ? t`Log ${value} completed`
                : t`Enter a quantity`}
          </Button>
        </View>
      </Sheet>
    );
  }
);

export const ScrapSheet = forwardRef<SheetHandle, ScrapSheetProps>(
  function ScrapSheet({ target, eventIds, onClose, onReplacementEntity }, ref) {
    const { t } = useLingui();
    const [quantity, setQuantity] = useState("1");
    const [notes, setNotes] = useState("");
    const [reasonId, setReasonId] = useState<string | null>(null);
    // Only fetched once the sheet is mounted with a reason still unpicked.
    const reasons = useScrapReasons(true);
    const report = useReportScrap(target.operationId);
    const serial = target.trackingType === "Serial";
    const value = serial ? 1 : parseQuantity(quantity);

    const submit = async () => {
      if (!value || !reasonId) return;
      try {
        const result = await report.mutateAsync({
          quantity: value,
          scrapReasonId: reasonId,
          notes: notes || undefined,
          ...trackingFields(target),
          ...eventIds
        });
        onClose();
        setQuantity("1");
        setNotes("");
        setReasonId(null);
        if (result.newTrackedEntityId) {
          onReplacementEntity(result.newTrackedEntityId);
          toast.success(t`Scrapped — a replacement unit is ready`);
        } else {
          toast.success(t`Scrapped ${value}`);
        }
      } catch (error) {
        toast.error(commandMessage(error, t`Could not report the scrap`));
      }
    };

    return (
      <Sheet ref={ref} title={t`Report scrap`}>
        <View className="gap-4 px-2 pt-2">
          {/*
            The reason comes BEFORE the quantity and the submit: scrapping is
            destructive and irreversible on the floor, and a sheet whose first
            control is the one that commits it invites a mis-tap.
          */}
          <View className="gap-2">
            <Muted className="text-sm">{t`Why was it scrapped?`}</Muted>
            {reasons.isLoading ? (
              <View className="gap-2">
                <Skeleton className="h-[56px]" />
                <Skeleton className="h-[56px]" />
              </View>
            ) : reasons.isError ? (
              <ErrorNote>{t`Could not load the scrap reasons.`}</ErrorNote>
            ) : (
              <ScrollView className="max-h-[240px]">
                <View className="gap-2">
                  {(reasons.data ?? []).map((reason) => {
                    const selected = reason.id === reasonId;
                    return (
                      <Pressable
                        key={reason.id}
                        onPress={() => setReasonId(reason.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        className={`min-h-[56px] justify-center rounded-lg border px-4 ${
                          selected
                            ? "border-red-500 bg-red-500/10"
                            : "border-border bg-card active:opacity-70"
                        }`}
                      >
                        <Body className={selected ? "font-semibold" : ""}>
                          {reason.name}
                        </Body>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </View>

          {serial ? (
            <>
              <SerialUnit target={target} />
              <Muted className="text-sm">
                {t`This unit will be permanently scrapped and a replacement serial number will be created.`}
              </Muted>
            </>
          ) : (
            <QuantityInput
              label={t`How many?`}
              value={quantity}
              onChange={setQuantity}
            />
          )}
          <Field
            label={t`Note (optional)`}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <Button
            variant="destructive"
            onPress={submit}
            disabled={!value || !reasonId || needsUnit(target)}
            loading={report.isPending}
          >
            {needsUnit(target)
              ? t`Choose the unit first`
              : reasonId
                ? value
                  ? t`Scrap ${value}`
                  : t`Enter a quantity`
                : t`Choose a reason`}
          </Button>
        </View>
      </Sheet>
    );
  }
);

export const ReworkSheet = forwardRef<SheetHandle, SheetProps>(
  function ReworkSheet({ target, eventIds, onClose }, ref) {
    const { t } = useLingui();
    const [quantity, setQuantity] = useState("1");
    const [notes, setNotes] = useState("");
    const targets = useReworkTargets(target.operationId, true);
    const report = useReportRework(target.operationId);
    const serial = target.trackingType === "Serial";
    const value = serial ? 1 : parseQuantity(quantity);

    const submit = async () => {
      if (!value) return;
      try {
        await report.mutateAsync({
          quantity: value,
          notes: notes || undefined,
          ...trackingFields(target),
          ...eventIds
        });
        onClose();
        setQuantity("1");
        setNotes("");
        toast.success(t`Sent ${value} for rework`);
      } catch (error) {
        toast.error(commandMessage(error, t`Could not report the rework`));
      }
    };

    return (
      <Sheet ref={ref} title={t`Report rework`}>
        <View className="gap-4 px-2 pt-2">
          {serial ? (
            <SerialUnit target={target} />
          ) : (
            <QuantityInput
              label={t`How many need rework?`}
              value={quantity}
              onChange={setQuantity}
            />
          )}
          {targets.isLoading ? (
            <Skeleton className="h-10" />
          ) : (targets.data ?? []).length ? (
            <Muted className="text-sm">
              {t`${(targets.data ?? []).length} earlier operation(s) can take this back.`}
            </Muted>
          ) : null}
          <Field
            label={t`Note (optional)`}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <Button
            onPress={submit}
            disabled={!value || needsUnit(target)}
            loading={report.isPending}
          >
            {needsUnit(target)
              ? t`Choose the unit first`
              : value
                ? t`Rework ${value}`
                : t`Enter a quantity`}
          </Button>
        </View>
      </Sheet>
    );
  }
);
