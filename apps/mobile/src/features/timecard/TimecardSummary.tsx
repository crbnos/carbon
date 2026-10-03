// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TimeCardEntry } from "@carbon/mes-core";
import { STATUS_COLOR_HEX } from "@carbon/utils/status-colors";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { Clock, Play } from "lucide-react-native";
import { useCallback } from "react";
import { Text, View } from "react-native";
import { Card, Muted, WarningNote } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { formatElapsed } from "~/features/operations/useTimer";
import {
  durationParts,
  entryDurationMs,
  formatClockMoment,
  startedBeforeToday,
  weekTotalMs
} from "./logic";

/**
 * A duration an operator reads, from a duration in milliseconds.
 *
 * The one place hours are turned into words, so the summary, the day headers,
 * the entry rows and both confirmations cannot disagree about what 7.983 hours
 * is called. A raw float is never shown: "7.98 hours" is not a number anybody
 * writes on a time sheet, and "8" hides fourteen minutes.
 *
 * Exported from this component file rather than from `logic.ts` because it
 * needs Lingui — the same shape `useDerivedTaxAmount` is exported from
 * `TaxFields` in the ERP for the same reason. The arithmetic it wraps
 * (`durationParts`) stays pure and tested.
 */
export function useDurationLabel() {
  const { t } = useLingui();
  return useCallback(
    (milliseconds: number) => {
      const { hours, minutes } = durationParts(milliseconds);
      return t`${hours}h ${minutes}m`;
    },
    [t]
  );
}

/** Fixed-width digits, so a ticking timer does not jitter its own layout. */
const TABULAR = { fontVariant: ["tabular-nums" as const] };

/**
 * Where the operator looks first: am I on the clock, for how long, and how much
 * does this week add up to.
 *
 * The open entry's timer and the week's total both come from the ONE `nowMs`
 * the screen ticks, so the live seconds and the total can never be a second
 * out of step with each other.
 *
 * The week's total is the big number because this screen is "My Hours"; the
 * live entry sits above it in emerald, which is the same colour web MES and
 * this app's Start button use for "running". Both carry their own label —
 * numbers with context, never bare.
 */
export function TimecardSummary({
  openEntry,
  entries,
  nowMs,
  timeZone,
  weekRange,
  isCurrentWeek
}: {
  openEntry: TimeCardEntry | null;
  entries: readonly TimeCardEntry[];
  nowMs: number;
  timeZone: string;
  weekRange: string;
  isCurrentWeek: boolean;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  const durationLabel = useDurationLabel();

  const clockedIn = Boolean(openEntry && !openEntry.clockOut);
  const totalMs = weekTotalMs(entries, nowMs);

  // Today on the DEVICE's calendar, re-read on every render — which while a
  // timer is running is every second, so an entry left open across midnight
  // starts naming its day without the operator reloading anything.
  const todayDay = today(timeZone || getLocalTimeZone()).toString();
  const staleEntry =
    clockedIn && openEntry
      ? startedBeforeToday(openEntry.clockIn, timeZone, todayDay)
      : false;

  return (
    <Card className="gap-4">
      <View className="flex-row items-center gap-3">
        {clockedIn ? (
          <Play size={20} color={STATUS_COLOR_HEX.green} />
        ) : (
          <Clock size={20} color={colors.mutedForeground} />
        )}
        <Text
          className={`flex-1 text-base font-medium ${
            clockedIn
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground"
          }`}
        >
          {clockedIn && openEntry
            ? t`Clocked in since ${formatClockMoment(openEntry.clockIn, timeZone, locale, todayDay)}`
            : t`Not clocked in`}
        </Text>
      </View>

      {clockedIn && openEntry ? (
        <View className="gap-1">
          <Text
            className="text-3xl font-semibold text-emerald-600 dark:text-emerald-400"
            style={TABULAR}
          >
            {formatElapsed(entryDurationMs(openEntry, nowMs))}
          </Text>
          <Muted className="text-sm">
            <Trans>On this entry</Trans>
          </Muted>
        </View>
      ) : null}

      {staleEntry && openEntry ? (
        // Web MES asks "Forgot to Clock Out?" here. This app cannot edit an
        // entry — that is deliberately web-only — so it says what it knows and
        // sends them to the one place that can fix it, rather than letting a
        // day-old entry keep counting up as if it were this morning's.
        <WarningNote>
          {t`Open since ${formatClockMoment(openEntry.clockIn, timeZone, locale, todayDay)} — before today. If you forgot to clock out, fix it in Carbon MES in a browser.`}
        </WarningNote>
      ) : null}

      <View className="gap-1">
        <Text
          className="text-4xl font-semibold text-foreground"
          style={TABULAR}
        >
          {durationLabel(totalMs)}
        </Text>
        <Muted className="text-sm">
          {isCurrentWeek ? t`This week` : weekRange}
        </Muted>
      </View>
    </Card>
  );
}
