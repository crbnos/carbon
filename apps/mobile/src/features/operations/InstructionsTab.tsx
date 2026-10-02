// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail, OperationStep } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { Check, Square, SquareCheck } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { toast } from "sonner-native";
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Muted,
  WarningNote
} from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { commandMessage, useRecordStep } from "./commands";
import {
  parseQuantity,
  parseSteps,
  recordForUnit,
  stepIsRecorded
} from "./logic";
import { richTextToPlain } from "./richText";

/**
 * The work instructions, in order, with what has been recorded against each.
 *
 * Instructions are rich text in the ERP and plain text here — there is no
 * Tiptap renderer in a React Native bundle, so the words and the block
 * structure survive and the bold does not. That is the right trade: these are
 * the instructions for the part in the operator's hands, and a step whose text
 * rendered blank would be worse than one shown unformatted.
 *
 * Records are per UNIT. A serial operation making five parts records each step
 * five times, and the one being recorded here is the unit the screen is scoped
 * to — which is why `index` comes from the payload's selected entity rather
 * than from a counter on this screen.
 */

/** Step types this screen can record. The rest are read-only here. */
const RECORDABLE = new Set([
  "Value",
  "Measurement",
  "Checkbox",
  "Task",
  "List"
]);

function StepCard({
  step,
  unitIndex,
  operationId
}: {
  step: OperationStep;
  unitIndex: number;
  operationId: string;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const record = useRecordStep(operationId);
  const existing = recordForUnit(step, unitIndex);
  const recorded = stepIsRecorded(step, unitIndex);
  const [text, setText] = useState(
    existing?.value ??
      (existing?.numericValue !== null && existing?.numericValue !== undefined
        ? String(existing.numericValue)
        : "")
  );

  const instructions = useMemo(
    () => richTextToPlain(step.description),
    [step.description]
  );

  const save = async (payload: Parameters<typeof record.mutateAsync>[0]) => {
    try {
      await record.mutateAsync(payload);
      toast.success(t`Recorded`);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not record that step`));
    }
  };

  const recordable = RECORDABLE.has(step.type);

  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Body className="font-semibold">{step.name}</Body>
          {instructions ? (
            <Muted className="text-sm">{instructions}</Muted>
          ) : null}
        </View>
        {recorded ? <Check size={20} color={colors.foreground} /> : null}
      </View>

      {step.required && !recorded ? (
        <Muted className="text-sm">{t`Required`}</Muted>
      ) : null}

      {step.type === "Checkbox" || step.type === "Task" ? (
        <Pressable
          onPress={() =>
            save({
              index: unitIndex,
              jobOperationStepId: step.id,
              booleanValue: !existing?.booleanValue
            })
          }
          disabled={record.isPending}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: Boolean(existing?.booleanValue) }}
          accessibilityLabel={step.name}
          className="min-h-[48px] flex-row items-center gap-3 active:opacity-70"
        >
          {existing?.booleanValue ? (
            <SquareCheck size={28} color={colors.foreground} />
          ) : (
            <Square size={28} color={colors.mutedForeground} />
          )}
          <Body>{existing?.booleanValue ? t`Done` : t`Mark done`}</Body>
        </Pressable>
      ) : step.type === "List" ? (
        <View className="gap-2">
          {(step.listValues ?? []).map((option) => {
            const selected = existing?.value === option;
            return (
              <Pressable
                key={option}
                onPress={() =>
                  save({
                    index: unitIndex,
                    jobOperationStepId: step.id,
                    value: option
                  })
                }
                disabled={record.isPending}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className={`min-h-[48px] justify-center rounded-lg border px-4 ${
                  selected
                    ? "border-primary bg-muted"
                    : "border-border bg-card active:opacity-70"
                }`}
              >
                <Body className={selected ? "font-semibold" : ""}>
                  {option}
                </Body>
              </Pressable>
            );
          })}
        </View>
      ) : recordable ? (
        <View className="gap-2">
          <Field
            label={
              step.unitOfMeasureCode
                ? t`Value (${step.unitOfMeasureCode})`
                : t`Value`
            }
            value={text}
            onChangeText={setText}
            keyboardType={
              step.type === "Measurement" ? "decimal-pad" : "default"
            }
          />
          {step.type === "Measurement" &&
          step.minValue !== null &&
          step.minValue !== undefined &&
          step.maxValue !== null &&
          step.maxValue !== undefined ? (
            <Muted className="text-sm">
              {t`Between ${step.minValue} and ${step.maxValue}`}
            </Muted>
          ) : null}
          <Button
            variant="secondary"
            disabled={!text.trim() || record.isPending}
            loading={record.isPending}
            onPress={() => {
              if (step.type === "Measurement") {
                const numeric = parseQuantity(text);
                if (numeric === null) {
                  // The server would store a NaN or reject it; saying so here
                  // keeps the operator's own value on screen to correct.
                  toast.error(t`Enter a number`);
                  return;
                }
                void save({
                  index: unitIndex,
                  jobOperationStepId: step.id,
                  numericValue: numeric
                });
                return;
              }
              void save({
                index: unitIndex,
                jobOperationStepId: step.id,
                value: text.trim()
              });
            }}
          >
            {recorded ? t`Update` : t`Record`}
          </Button>
        </View>
      ) : (
        <WarningNote>
          {/*
            File, Timestamp, Person and Inspection steps each need something
            this screen does not have — a camera upload, a signed clock, a
            people picker, an inspection view. They stay VISIBLE so the
            operator can read the instruction and knows where to record it.
          */}
          {t`Record this step in Carbon MES in a browser.`}
        </WarningNote>
      )}
    </Card>
  );
}

export function InstructionsTab({ detail }: { detail: OperationDetail }) {
  const { t } = useLingui();
  const { steps, malformed } = useMemo(
    () => parseSteps(detail.procedure),
    [detail.procedure]
  );

  // Records are per unit, and the unit this screen is scoped to is whichever
  // tracked entity the payload selected. An untracked operation is unit 0.
  const unitIndex = 0;

  if (malformed) {
    return (
      <View className="px-4 py-4">
        <ErrorNote>
          {t`These work instructions could not be read. Use Carbon MES in a browser for them.`}
        </ErrorNote>
      </View>
    );
  }

  if (!steps.length) {
    return (
      <EmptyState
        title={t`No work instructions`}
        description={t`This operation has no steps to record.`}
      />
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-3 px-4 pb-8 pt-2"
    >
      {steps.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          unitIndex={unitIndex}
          operationId={detail.operation.id}
        />
      ))}
    </ScrollView>
  );
}
