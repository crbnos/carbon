// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { canViewNextWeek, nextWeek, previousWeek } from "./logic";

/**
 * Previous and next week, through the server's `weekOffset`.
 *
 * Next is DISABLED in place at offset 0 rather than removed: a control that
 * vanishes reads as a glitch, and a greyed one with the centre label saying
 * "This week" tells the operator why without a line of apology on a screen
 * they open every day. The hint carries the same sentence for a screen reader.
 *
 * There is nothing above zero to navigate to — a week that has not begun has
 * no hours in it, and `nextWeek` clamps rather than trusting the caller.
 *
 * The range itself is the server's `weekStart`/`weekEnd` — Monday and Sunday
 * on the company's payroll calendar — already formatted by `formatWeekRange`.
 * This component never computes a week: a week containing a daylight-saving
 * transition is 167 or 169 hours, and the only copy of that boundary that may
 * decide an operator's pay is the books'.
 */
export function WeekNav({
  weekOffset,
  weekRange,
  onChange
}: {
  weekOffset: number;
  weekRange: string;
  onChange: (weekOffset: number) => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const canGoForward = canViewNextWeek(weekOffset);

  return (
    <View className="flex-row items-center justify-between">
      <Pressable
        onPress={() => onChange(previousWeek(weekOffset))}
        accessibilityRole="button"
        accessibilityLabel={t`Prev`}
        className="min-h-[48px] flex-row items-center gap-1 rounded-lg border border-border bg-card px-4 active:opacity-80"
      >
        <ChevronLeft size={20} color={colors.foreground} />
        <Text className="text-base text-foreground">
          <Trans>Prev</Trans>
        </Text>
      </Pressable>

      <View className="items-center">
        <Text className="text-base font-medium text-foreground">
          {weekRange}
        </Text>
        {weekOffset === 0 ? (
          <Muted className="text-sm">
            <Trans>This week</Trans>
          </Muted>
        ) : null}
      </View>

      <Pressable
        onPress={() => canGoForward && onChange(nextWeek(weekOffset))}
        disabled={!canGoForward}
        accessibilityRole="button"
        accessibilityLabel={t`Next`}
        accessibilityState={{ disabled: !canGoForward }}
        accessibilityHint={
          canGoForward ? undefined : t`This is the current week`
        }
        className={`min-h-[48px] flex-row items-center gap-1 rounded-lg border border-border bg-card px-4 ${
          canGoForward ? "active:opacity-80" : "opacity-50"
        }`}
      >
        <Text className="text-base text-foreground">
          <Trans>Next</Trans>
        </Text>
        <ChevronRight size={20} color={colors.foreground} />
      </Pressable>
    </View>
  );
}
