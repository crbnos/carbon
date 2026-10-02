// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { InspectionSample } from "@carbon/mes-core";
import {
  STATUS_COLOR_HEX,
  type StatusColor,
  statusColor
} from "@carbon/utils/status-colors";
import { useLingui } from "@lingui/react/macro";
import { Circle, CircleCheck, CircleX, Plus } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";

/**
 * The lot's units, as a row of chips — web's grid COLUMNS, turned on their
 * side.
 *
 * The web renders characteristics × units as a table. That does not survive
 * the trip to a tablet: eight characteristics across five units is forty
 * cells, and at 48pt — the floor for a gloved thumb — the grid is wider than
 * any screen in the building. So the screen is pivoted to one unit at a time:
 * this strip picks the unit, and the list under it is that unit's
 * characteristics. It is also how an inspector actually works, with one part
 * in hand.
 *
 * Nothing is lost by the pivot. Every unit's verdict is on its chip, so the
 * across-the-lot picture the table gave is still here; it is the per-cell
 * detail that now takes a tap.
 *
 * Chips are addressed by column INDEX, not sample id, exactly as the web grid
 * is: a lot that is not serial pre-offers one spare column, and that column's
 * sample row does not exist until the first reading is written into it.
 */

const STATUS_ICONS = {
  Passed: CircleCheck,
  Failed: CircleX,
  Pending: Circle
} as const;

export function UnitStrip({
  columns,
  samples,
  statuses,
  selected,
  onSelect,
  isSerial,
  onScan,
  disabled = false
}: {
  /** Column indices, from `columnCount`. */
  columns: number[];
  /** Column index -> the sample in it, where one exists yet. */
  samples: (InspectionSample | undefined)[];
  /** Sample id -> verdict, with local patches applied. */
  statuses: Map<string, string>;
  selected: number;
  onSelect: (columnIndex: number) => void;
  isSerial: boolean;
  /** Serial lots add a unit by scanning it; others never call this. */
  onScan?: () => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between px-4">
        <Muted className="text-sm">{isSerial ? t`Units` : t`Samples`}</Muted>
        {/* The count is here rather than on the chips: an inspector checks
            "have I done enough yet" far more often than any one unit. */}
        <Muted className="text-sm">
          {t`${samples.filter(Boolean).length} of ${columns.length}`}
        </Muted>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 pb-1"
      >
        {columns.map((columnIndex) => {
          const sample = samples[columnIndex];
          const status = sample ? statuses.get(sample.id) : undefined;
          const tone: StatusColor = status
            ? statusColor("inspection", status) || "gray"
            : "gray";
          const Icon =
            status && status in STATUS_ICONS
              ? STATUS_ICONS[status as keyof typeof STATUS_ICONS]
              : null;
          const isSelected = columnIndex === selected;
          // A serial unit is named by its own id; anything else is just the
          // nth sample, which is all the operator needs to keep their place.
          const label =
            sample?.trackedEntity?.readableId ?? t`#${columnIndex + 1}`;

          return (
            <Pressable
              key={columnIndex}
              onPress={() => onSelect(columnIndex)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={
                status
                  ? t`Unit ${label}, ${status}`
                  : t`Unit ${label}, not inspected`
              }
              className={`min-h-[48px] min-w-[76px] flex-row items-center justify-center gap-2 rounded-lg border px-3 active:opacity-70 ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card"
              }`}
            >
              {Icon ? (
                <Icon size={16} color={STATUS_COLOR_HEX[tone]} />
              ) : (
                <Circle size={16} color={colors.mutedForeground} />
              )}
              <Text
                className={`text-base ${
                  isSelected
                    ? "font-semibold text-foreground"
                    : "text-foreground"
                }`}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}

        {isSerial && onScan && !disabled ? (
          <Pressable
            onPress={onScan}
            accessibilityRole="button"
            accessibilityLabel={t`Scan a unit`}
            className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 active:opacity-70"
          >
            <Plus size={18} color={colors.mutedForeground} />
            <Text className="text-base text-muted-foreground">{t`Scan`}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
