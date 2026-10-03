// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyStep } from "@carbon/mes-core";
import { getLocalTimeZone, now } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import {
  Check,
  Image as ImageIcon,
  ScanLine,
  Undo2
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { toast } from "sonner-native";
import { Body, Button, Card, Field, Muted, WarningNote } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import {
  commandMessage,
  useDeleteStepRecord,
  useRecordStep
} from "~/features/operations/commands";
import { richTextToPlain } from "~/features/operations/richText";
import { StepPhoto } from "~/features/operations/StepPhoto";
import {
  isStepBadResult,
  parseMeasurement,
  recordedDisplay,
  recordFor,
  stepChipState
} from "./logic";

const DONE = "#10b981";
const BAD = "#ef4444";

/**
 * The steps bar: one chip per step, green when this unit has recorded it, red
 * when what it recorded is out of spec, outlined where the operator is. Web's
 * segmented bar, numbered, because on a phone a segment thinner than a thumb
 * cannot be tapped and a number says where you are.
 */
export function StepsBar({
  steps,
  unitIndex,
  current,
  onSelect
}: {
  steps: AssemblyStep[];
  unitIndex: number;
  current: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const done = steps.filter(
    (step) => stepChipState(step, unitIndex) !== "todo"
  ).length;

  return (
    <View className="gap-2">
      <Muted className="text-sm">{t`${done} / ${steps.length} done`}</Muted>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-1.5"
      >
        {steps.map((step, index) => {
          const state = stepChipState(step, unitIndex);
          const selected = index === current;
          return (
            <Pressable
              key={step.id}
              onPress={() => onSelect(index)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t`Step ${index + 1}: ${step.name}`}
              className="size-10 items-center justify-center rounded-md active:opacity-70"
              style={{
                backgroundColor:
                  state === "done"
                    ? DONE
                    : state === "bad"
                      ? BAD
                      : colors.muted,
                borderWidth: selected ? 2 : 0,
                borderColor: colors.foreground
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{
                  color: state === "todo" ? colors.foreground : "#ffffff"
                }}
              >
                {index + 1}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * One step of the unit on screen: what to do, and the one action that records
 * it.
 *
 * Every step type web's `RecordModal` takes is recorded here IN PLACE, without
 * a modal on top of the step — on a phone the modal would cover the
 * instruction the operator is following. Person is the one exception: it
 * needs a people picker this app does not have, so it says where to record it.
 *
 * `gated` is web's soft scan gate. While a tracked part of this step has not
 * been issued to this unit, recording is held — Skip is not, because an
 * operator may need to look ahead.
 */
export function StepCard({
  operationId,
  step,
  index,
  total,
  unitIndex,
  userId,
  gatedBy,
  busy,
  onPrevious,
  onNext
}: {
  operationId: string;
  step: AssemblyStep;
  index: number;
  total: number;
  unitIndex: number;
  /** Whose record may be undone: only its creator's, as on the web. */
  userId: string | null;
  /** Tracked parts still to scan for this step, by name. Empty: not gated. */
  gatedBy: string[];
  /** The screen is between units; nothing may be recorded against either. */
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const record = useRecordStep(operationId);
  const undo = useDeleteStepRecord(operationId);
  const existing = recordFor(step, unitIndex);
  const bad = isStepBadResult(step, unitIndex);
  const description = useMemo(
    () => richTextToPlain(step.description),
    [step.description]
  );
  const slides = (step.jobOperationStepSlide ?? []).length;
  const type = step.type ?? "Task";
  const gated = gatedBy.length > 0;
  const blocked = gated || busy || record.isPending;

  const save = async (payload: {
    value?: string;
    numericValue?: number;
    booleanValue?: boolean;
  }) => {
    try {
      await record.mutateAsync({
        ...payload,
        index: unitIndex,
        jobOperationStepId: step.id
      });
    } catch (error) {
      toast.error(commandMessage(error, t`Could not record that step`));
    }
  };

  const typeLabel: Record<string, string> = {
    Task: t`Task`,
    Value: t`Value`,
    Measurement: t`Measurement`,
    Checkbox: t`Checkbox`,
    Timestamp: t`Timestamp`,
    Person: t`Person`,
    List: t`List`,
    File: t`File`,
    Inspection: t`Inspection`
  };

  return (
    <Card className="gap-4">
      <View className="gap-1">
        <View className="flex-row items-center justify-between gap-3">
          <Muted className="text-sm">{t`Step ${index + 1} of ${total}`}</Muted>
          <Muted className="text-sm">{typeLabel[type] ?? type}</Muted>
        </View>
        <Text className="text-xl font-semibold leading-tight text-foreground">
          {step.name}
        </Text>
        {step.required && !existing ? (
          <Muted className="text-sm">{t`Required`}</Muted>
        ) : null}
      </View>

      {description && description !== "{}" ? <Body>{description}</Body> : null}

      {slides > 0 ? (
        <View className="flex-row items-center gap-2">
          <ImageIcon size={16} color={colors.mutedForeground} />
          <Muted className="flex-1 text-sm">
            {slides === 1
              ? t`This step has a reference image. Open the job in Carbon MES on the web to see it.`
              : t`This step has ${slides} reference images. Open the job in Carbon MES on the web to see them.`}
          </Muted>
        </View>
      ) : null}

      {existing ? (
        <Recorded
          step={step}
          display={recordedDisplay(step, existing)}
          bad={bad}
          canUndo={existing.createdBy === userId}
          undoing={undo.isPending}
          onUndo={async () => {
            try {
              await undo.mutateAsync(existing.id);
            } catch (error) {
              toast.error(commandMessage(error, t`Could not undo that`));
            }
          }}
        />
      ) : (
        <>
          {gated ? (
            <View className="flex-row items-start gap-2 rounded-lg border border-orange-500/50 bg-orange-500/10 p-3">
              <ScanLine size={18} color="#f97316" />
              <Text className="flex-1 text-sm text-foreground">
                {gatedBy.length === 1
                  ? t`Scan ${gatedBy[0]} to complete this step.`
                  : t`Scan ${gatedBy.length} parts to complete this step: ${gatedBy.join(", ")}.`}
              </Text>
            </View>
          ) : null}
          <RecordControl
            key={`${step.id}:${unitIndex}`}
            step={step}
            unitIndex={unitIndex}
            operationId={operationId}
            disabled={blocked}
            pending={record.isPending}
            onSave={save}
          />
        </>
      )}

      <View className="flex-row items-center justify-between gap-3">
        <Button
          variant="ghost"
          onPress={onPrevious}
          disabled={index === 0}
          className="px-3"
        >
          {t`‹ Previous`}
        </Button>
        <Button
          variant="secondary"
          onPress={onNext}
          disabled={index >= total - 1}
          className="px-4"
        >
          {t`Skip ›`}
        </Button>
      </View>
    </Card>
  );
}

function Recorded({
  step,
  display,
  bad,
  canUndo,
  undoing,
  onUndo
}: {
  step: AssemblyStep;
  display: string | null;
  bad: boolean;
  canUndo: boolean;
  undoing: boolean;
  onUndo: () => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const tone = bad ? BAD : DONE;
  return (
    <View className="gap-2">
      <View
        className="min-h-[52px] flex-row items-center gap-3 rounded-lg px-3 py-2"
        style={{
          borderWidth: 1,
          borderColor: `${tone}66`,
          backgroundColor: `${tone}1A`
        }}
      >
        <Check size={20} color={tone} />
        <Text className="min-w-0 flex-1 text-base text-foreground">
          {display
            ? bad
              ? t`Recorded: ${display} — out of spec`
              : t`Recorded: ${display}`
            : t`Completed`}
        </Text>
        <Pressable
          onPress={onUndo}
          disabled={!canUndo || undoing}
          accessibilityRole="button"
          accessibilityLabel={t`Undo ${step.name}`}
          accessibilityState={{ disabled: !canUndo || undoing }}
          className={`size-11 items-center justify-center rounded-lg ${
            canUndo ? "active:opacity-60" : "opacity-40"
          }`}
        >
          <Undo2 size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {canUndo ? null : (
        <Muted className="text-sm">
          {t`Only the operator who recorded this can undo it.`}
        </Muted>
      )}
    </View>
  );
}

/** The control that records one step, by type. */
function RecordControl({
  step,
  unitIndex,
  operationId,
  disabled,
  pending,
  onSave
}: {
  step: AssemblyStep;
  unitIndex: number;
  operationId: string;
  disabled: boolean;
  pending: boolean;
  onSave: (payload: {
    value?: string;
    numericValue?: number;
    booleanValue?: boolean;
  }) => Promise<void>;
}) {
  const { t } = useLingui();
  // Keyed by step and unit at the call site, so a new step or unit starts from
  // an empty field rather than the last one's value.
  const [text, setText] = useState("");
  const type = step.type ?? "Task";

  switch (type) {
    case "Task":
      return (
        <Button
          onPress={() => onSave({ booleanValue: true })}
          disabled={disabled}
          loading={pending}
        >
          {t`Mark done`}
        </Button>
      );
    case "Checkbox":
    case "Inspection": {
      const yes = type === "Inspection" ? t`Passed` : t`Yes`;
      const no = type === "Inspection" ? t`Failed` : t`No`;
      return (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button
              onPress={() => onSave({ booleanValue: true })}
              disabled={disabled}
              loading={pending}
            >
              {yes}
            </Button>
          </View>
          <View className="flex-1">
            <Button
              variant="secondary"
              onPress={() => onSave({ booleanValue: false })}
              disabled={disabled}
            >
              {no}
            </Button>
          </View>
        </View>
      );
    }
    case "List":
      return (
        <View className="gap-2">
          {(step.listValues ?? []).map((option) => (
            <Pressable
              key={option}
              onPress={() => onSave({ value: option })}
              disabled={disabled}
              accessibilityRole="button"
              className={`min-h-[52px] justify-center rounded-lg border border-border bg-card px-4 ${
                disabled ? "opacity-50" : "active:opacity-70"
              }`}
            >
              <Body>{option}</Body>
            </Pressable>
          ))}
        </View>
      );
    case "Timestamp":
      return (
        <Button
          onPress={() =>
            onSave({ value: now(getLocalTimeZone()).toAbsoluteString() })
          }
          disabled={disabled}
          loading={pending}
        >
          {t`Record the time now`}
        </Button>
      );
    case "File":
      return disabled ? (
        <Muted className="text-sm">{t`Scan the parts first.`}</Muted>
      ) : (
        <StepPhoto
          step={step}
          unitIndex={unitIndex}
          operationId={operationId}
        />
      );
    case "Value":
    case "Measurement": {
      const measurement = type === "Measurement";
      const numeric = measurement ? parseMeasurement(text) : null;
      const ready = measurement ? numeric !== null : text.trim().length > 0;
      const limits =
        measurement && (step.minValue != null || step.maxValue != null)
          ? step.minValue != null && step.maxValue != null
            ? t`Between ${step.minValue} and ${step.maxValue}`
            : step.minValue != null
              ? t`At least ${step.minValue}`
              : t`At most ${step.maxValue}`
          : null;
      return (
        <View className="gap-2">
          <Field
            label={
              step.unitOfMeasureCode
                ? t`Value (${step.unitOfMeasureCode})`
                : t`Value`
            }
            value={text}
            onChangeText={setText}
            keyboardType={measurement ? "numbers-and-punctuation" : "default"}
            editable={!disabled}
            returnKeyType="done"
          />
          {limits ? <Muted className="text-sm">{limits}</Muted> : null}
          <Button
            onPress={() =>
              measurement
                ? numeric !== null && onSave({ numericValue: numeric })
                : onSave({ value: text.trim() })
            }
            disabled={disabled || !ready}
            loading={pending}
          >
            {t`Record`}
          </Button>
        </View>
      );
    }
    default:
      return (
        <WarningNote>{t`Record this step in Carbon MES in a browser.`}</WarningNote>
      );
  }
}
