// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyTrackedEntity } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  ListOrdered
} from "lucide-react-native";
import { forwardRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import { Body, Field, Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { matchEntityToScan } from "~/features/operations/trackedIssue";
import type { Unit } from "./logic";

const BUILT = "#10b981";
const BAD = "#ef4444";

export type UnitRow = {
  unit: Unit<AssemblyTrackedEntity>;
  built: boolean;
  bad: boolean;
  /** Beyond the last minted serial: it cannot be worked on yet. */
  locked: boolean;
};

/**
 * "Unit 3 of 10" with the serial it is bound to, and the pager either side.
 *
 * Web keeps this as a list in its left sidebar. A phone has no sidebar, so the
 * pager is one row under the header and the full list is a sheet behind it —
 * the same information, one tap further away, and never pushing the step the
 * operator is working on off the screen.
 */
export function UnitPager({
  index,
  count,
  built,
  entity,
  trackingLabel,
  bad,
  canPrevious,
  canNext,
  loading,
  onPrevious,
  onNext,
  onOpenList
}: {
  index: number;
  count: number;
  built: number;
  entity: AssemblyTrackedEntity | null;
  /** "S/N" for a serial parent, "Batch" for a batch one, null when untracked. */
  trackingLabel: string | null;
  bad: boolean;
  canPrevious: boolean;
  canNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onOpenList: () => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();

  return (
    <View className="flex-row items-center gap-2">
      <PagerButton
        icon={ChevronLeft}
        label={t`Previous unit`}
        disabled={!canPrevious}
        onPress={onPrevious}
      />
      <Pressable
        onPress={onOpenList}
        accessibilityRole="button"
        accessibilityLabel={t`Unit ${index + 1} of ${count}. Show every unit.`}
        className="min-h-[52px] min-w-0 flex-1 flex-row items-center gap-3 rounded-lg border border-border bg-card px-3 active:opacity-70"
      >
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold text-foreground">
              {t`Unit ${index + 1} of ${count}`}
            </Text>
            {bad ? <CircleX size={16} color={BAD} /> : null}
            {loading ? <ActivityIndicator size="small" /> : null}
          </View>
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {entity && trackingLabel
              ? `${trackingLabel} ${entity.readableId ?? entity.id}`
              : t`${built} of ${count} built`}
          </Text>
        </View>
        <ListOrdered size={20} color={colors.mutedForeground} />
      </Pressable>
      <PagerButton
        icon={ChevronRight}
        label={t`Next unit`}
        disabled={!canNext}
        onPress={onNext}
      />
    </View>
  );
}

function PagerButton({
  icon: Icon,
  label,
  disabled,
  onPress
}: {
  icon: typeof ChevronLeft;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`size-[52px] items-center justify-center rounded-lg border border-border bg-card ${
        disabled ? "opacity-40" : "active:opacity-70"
      }`}
    >
      <Icon size={24} color={colors.foreground} />
    </Pressable>
  );
}

/**
 * Every unit, and which one to work on.
 *
 * On an operation AFTER the first one, a serial unit already carries the label
 * printed when it was started, so the operator picks the unit they are holding
 * — by scanning that label or from the list — rather than being handed the
 * next one in order. Web opens its serial picker for exactly that, and so does
 * this screen.
 */
export const UnitSheet = forwardRef<
  SheetHandle,
  {
    rows: UnitRow[];
    currentIndex: number;
    trackingLabel: string | null;
    /** True on a serial parent: units are found by their label. */
    scannable: boolean;
    onChoose: (index: number) => void;
  }
>(function UnitSheet(
  { rows, currentIndex, trackingLabel, scannable, onChoose },
  ref
) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const [code, setCode] = useState("");

  const anyLocked = rows.some((row) => row.locked);

  const scan = () => {
    const text = code.trim();
    if (!text) return;
    setCode("");
    const entities = rows
      .map((row) => row.unit.entity)
      .filter((entity): entity is AssemblyTrackedEntity => entity != null);
    const match = matchEntityToScan(entities, text);
    const row = match
      ? rows.find((candidate) => candidate.unit.entity?.id === match.id)
      : undefined;
    if (!row) {
      toast.error(t`${text} is not a unit of this operation`);
      return;
    }
    onChoose(row.unit.index);
  };

  return (
    <Sheet ref={ref} title={t`Units`}>
      <View className="gap-3 px-2 pt-1">
        {scannable ? (
          <Field
            label={t`Scan or type the serial number`}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={scan}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="go"
          />
        ) : null}
        {anyLocked ? (
          // Said once, not on every row: a serial parent mints the next
          // unit's serial as the one before it completes.
          <Muted className="text-sm">
            {t`Each unit's serial is made when the unit before it is complete.`}
          </Muted>
        ) : null}
        <View className="gap-2">
          {rows.map((row) => {
            const selected = row.unit.index === currentIndex;
            const entity = row.unit.entity;
            return (
              <Pressable
                key={row.unit.index}
                onPress={() => onChoose(row.unit.index)}
                disabled={row.locked}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: row.locked }}
                className={`min-h-[56px] flex-row items-center gap-3 rounded-lg border px-3 py-2 ${
                  selected ? "border-primary bg-muted" : "border-border bg-card"
                } ${row.locked ? "opacity-40" : "active:opacity-70"}`}
              >
                {row.bad ? (
                  <CircleX size={22} color={BAD} />
                ) : row.built ? (
                  <CircleCheck size={22} color={BUILT} />
                ) : (
                  <View
                    className="size-[22px] rounded-full border-2"
                    style={{ borderColor: colors.mutedForeground }}
                  />
                )}
                <View className="min-w-0 flex-1">
                  <Body className="font-semibold">
                    {t`Unit ${row.unit.index + 1}`}
                  </Body>
                  {entity && trackingLabel ? (
                    <Muted className="text-sm" numberOfLines={1}>
                      {`${trackingLabel} ${entity.readableId ?? entity.id}`}
                    </Muted>
                  ) : null}
                </View>
                <Muted className="text-sm">
                  {row.bad ? t`Failed` : row.built ? t`Built` : ""}
                </Muted>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Sheet>
  );
});
