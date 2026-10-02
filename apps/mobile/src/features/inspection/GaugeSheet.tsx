// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { InspectionGauge } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import {
  Check,
  Gauge as GaugeIcon,
  TriangleAlert,
  X
} from "lucide-react-native";
import { forwardRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import { Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { gaugeLabel, gaugeOptions, isOutOfCalibration } from "./logic";

/**
 * Which gauge measured a characteristic.
 *
 * Gauges used recently at this station come first — on a floor the one an
 * inspector wants is nearly always the one they just put down, and the full
 * list can run to hundreds.
 *
 * An out-of-calibration gauge is LISTED, with a warning. Hiding it would be
 * the stricter-looking choice and the worse one: an inspector whose only
 * micrometer is a day past its due date would have no way to record what they
 * actually measured with, and the reading would go in with no gauge at all.
 */
export const GaugeSheet = forwardRef<
  SheetHandle,
  {
    gauges: InspectionGauge[];
    recentGaugeIds: string[];
    /** The characteristic's required gauge type; null takes any gauge. */
    gaugeTypeId: string | null;
    /** The gauge currently recorded, if any. */
    value: string | null;
    onSelect: (gaugeId: string | null) => void;
  }
>(function GaugeSheet(
  { gauges, recentGaugeIds, gaugeTypeId, value, onSelect },
  ref
) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const { recent, rest } = gaugeOptions(gauges, recentGaugeIds, gaugeTypeId);

  const row = (gauge: InspectionGauge) => {
    const selected = gauge.id === value;
    const lapsed = isOutOfCalibration(gauge);
    return (
      <Pressable
        key={gauge.id}
        onPress={() => onSelect(gauge.id)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={
          lapsed
            ? t`${gaugeLabel(gauge) ?? ""}, out of calibration`
            : (gaugeLabel(gauge) ?? "")
        }
        className={`min-h-[56px] flex-row items-center gap-3 rounded-lg px-2 active:bg-muted ${
          selected ? "bg-primary/10" : ""
        }`}
      >
        {lapsed ? (
          <TriangleAlert size={20} color={colors.destructive} />
        ) : (
          <GaugeIcon size={20} color={colors.mutedForeground} />
        )}
        <View className="min-w-0 flex-1">
          <Text className="text-base text-foreground" numberOfLines={1}>
            {gaugeLabel(gauge)}
          </Text>
          {gauge.description && gauge.gaugeId ? (
            <Muted className="text-sm" numberOfLines={1}>
              {gauge.description}
            </Muted>
          ) : null}
          {lapsed ? (
            <Text className="text-sm text-destructive">
              {t`Out of calibration`}
            </Text>
          ) : null}
        </View>
        {selected ? <Check size={20} color={colors.primary} /> : null}
      </Pressable>
    );
  };

  return (
    <Sheet ref={ref} title={t`Gauge`}>
      {value ? (
        <Pressable
          onPress={() => onSelect(null)}
          accessibilityRole="button"
          accessibilityLabel={t`Clear the gauge`}
          className="min-h-[56px] flex-row items-center gap-3 rounded-lg px-2 active:bg-muted"
        >
          <X size={20} color={colors.mutedForeground} />
          <Text className="text-base text-muted-foreground">{t`No gauge`}</Text>
        </Pressable>
      ) : null}

      {recent.length > 0 ? (
        <>
          <Muted className="px-2 pt-3 text-sm">{t`Recently used here`}</Muted>
          {recent.map(row)}
        </>
      ) : null}

      {rest.length > 0 ? (
        <>
          {recent.length > 0 ? (
            <Muted className="px-2 pt-3 text-sm">{t`All gauges`}</Muted>
          ) : null}
          {rest.map(row)}
        </>
      ) : null}

      {recent.length === 0 && rest.length === 0 ? (
        <Muted className="px-2 py-6 text-center">
          {/* Named rather than blank: "no gauges" and "no gauges OF THIS TYPE"
              send an inspector to two different people. */}
          {gaugeTypeId
            ? t`No active gauge of the type this characteristic needs.`
            : t`No active gauges.`}
        </Muted>
      ) : null}
    </Sheet>
  );
});
