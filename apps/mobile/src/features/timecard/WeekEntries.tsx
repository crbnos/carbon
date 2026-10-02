// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TimeCardEntry } from "@carbon/mes-core";
import { Trans, useLingui } from "@lingui/react/macro";
import { Text, View } from "react-native";
import { Body, Card, Muted } from "~/components/ui";
import {
  type DayGroup,
  entryDurationMs,
  formatClockTime,
  formatDayLabel
} from "./logic";
import { useDurationLabel } from "./TimecardSummary";

/**
 * The week's entries, one card per day, newest day first.
 *
 * Grouped by the day the operator was standing in (see `entryCalendarDay`) and
 * each day carries its own total, because "did Monday come out right" is the
 * question somebody opens this screen to answer — a flat list of times makes
 * them add it up themselves.
 *
 * An entry still open shows "Active" and its live duration rather than a blank
 * clock-out, matching web MES's own badge.
 */
export function WeekEntries({
  groups,
  timeZone,
  nowMs
}: {
  groups: DayGroup<TimeCardEntry>[];
  timeZone: string;
  nowMs: number;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const durationLabel = useDurationLabel();

  return (
    <View className="gap-3">
      {groups.map((group) => (
        <Card key={group.day || "unknown"} className="gap-3">
          <View className="flex-row items-center justify-between">
            <Body className="font-semibold">
              {group.day ? formatDayLabel(group.day, locale) : t`Day unknown`}
            </Body>
            <Muted className="text-sm">{durationLabel(group.totalMs)}</Muted>
          </View>

          {group.entries.map((entry) => {
            const open = !entry.clockOut;
            return (
              <View key={entry.id} className="gap-1">
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1 flex-row items-center gap-2">
                    <Body>
                      {formatClockTime(entry.clockIn, timeZone, locale)}
                    </Body>
                    <Muted>{"→"}</Muted>
                    {open ? (
                      <View className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5">
                        <Text className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                          <Trans>Active</Trans>
                        </Text>
                      </View>
                    ) : (
                      <Body>
                        {formatClockTime(
                          entry.clockOut ?? "",
                          timeZone,
                          locale
                        )}
                      </Body>
                    )}
                  </View>
                  <Body className="font-medium">
                    {durationLabel(entryDurationMs(entry, nowMs))}
                  </Body>
                </View>
                {entry.note ? (
                  <Muted className="text-sm">{entry.note}</Muted>
                ) : null}
              </View>
            );
          })}
        </Card>
      ))}
    </View>
  );
}
