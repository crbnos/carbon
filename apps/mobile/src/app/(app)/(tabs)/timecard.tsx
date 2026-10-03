// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLocalTimeZone } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFocusEffect } from "expo-router";
import { Play, Square } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { toast } from "sonner-native";
import { ActionDock } from "~/components/ActionDock";
import type { SheetHandle } from "~/components/BottomSheet";
import { HeroButton } from "~/components/HeroButton";
import {
  Button,
  EmptyState,
  ErrorNote,
  Heading,
  Screen,
  Skeleton
} from "~/components/ui";
import { usePullToRefresh } from "~/components/usePullToRefresh";
import { ClockOutDialog } from "~/features/timecard/ClockOutDialog";
import { commandMessage, useClockIn } from "~/features/timecard/commands";
import { EndShiftDialog } from "~/features/timecard/EndShiftDialog";
import {
  clockAction,
  dayGroups,
  formatWeekRange
} from "~/features/timecard/logic";
import { TimecardActionsSheet } from "~/features/timecard/TimecardActionsSheet";
import { TimecardSummary } from "~/features/timecard/TimecardSummary";
import { useNowMs } from "~/features/timecard/useNowMs";
import { useTimecardQuery } from "~/features/timecard/useTimecardQuery";
import { WeekEntries } from "~/features/timecard/WeekEntries";
import { WeekNav } from "~/features/timecard/WeekNav";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The operator's own hours: the week, the entry that is open, and the one
 * action the current state calls for.
 *
 * Three things here are deliberate.
 *
 * **One dominant action.** Clock In when they are out, Clock Out when they are
 * in — never both, and never a second button beside it that also stops work.
 * End shift closes every running timer as well as the time card, so it lives
 * in the sheet behind a confirmation that lists what it will do.
 *
 * **The week comes from the server.** `weekStart` and `weekEnd` are Monday and
 * Sunday on the COMPANY calendar — the payroll one — and this screen only ever
 * formats them. Computing a week here would be a second boundary that can
 * disagree with the books, and a week containing a daylight-saving transition
 * is 167 or 169 hours rather than a tidy seven times twenty-four.
 *
 * **A failure stays here.** A 409 from either command means the state moved
 * under the operator: a supervisor clocked them out, or the auto-close shift
 * did. Both commands refetch whatever the outcome, so the screen corrects
 * itself, and the operator reads the server's own sentence in a toast rather
 * than being sent somewhere else to work out what happened.
 */
export default function Timecard() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const { operatorToken } = useAuth();

  const [weekOffset, setWeekOffset] = useState(0);
  // The ENTRY being clocked out, not a boolean. A boolean left over from an
  // entry somebody else closed would re-open this dialog by itself the next
  // time the operator clocked in — a new clock-in is a new row with a new id,
  // so an id can only ever match the entry it was set for.
  const [clockingOutId, setClockingOutId] = useState<string | null>(null);
  const [endingShift, setEndingShift] = useState(false);
  const moreSheet = useRef<SheetHandle>(null);

  const query = useTimecardQuery(weekOffset);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const screen = query.data;
  const openEntry = screen?.openEntry ?? null;
  const clockedIn = clockAction(openEntry) === "clock_out";

  // One clock read for the whole screen, and only while something is actually
  // running — a settled week has nothing to tick.
  const nowMs = useNowMs(clockedIn ? 1000 : null);
  // The DEVICE's zone, which on a tablet clamped to a machine is the plant's,
  // and which `date-handling.md` says is the right zone for display. It only
  // ever labels and groups entries the server already placed in this week.
  const timeZone = useMemo(() => getLocalTimeZone(), []);

  const clockIn = useClockIn();

  // The floor moves while the operator is on another screen: somebody may have
  // clocked them out, and the first thing they see must be the real state.
  useFocusEffect(
    useCallback(() => {
      void query.refetch();
    }, [query.refetch])
  );

  const weekRange = screen
    ? formatWeekRange(screen.weekStart, screen.weekEnd, locale)
    : "";

  const groups = useMemo(
    () => dayGroups(screen?.entries ?? [], timeZone, nowMs),
    [screen?.entries, timeZone, nowMs]
  );

  const press = async () => {
    if (clockedIn && openEntry) {
      setClockingOutId(openEntry.id);
      return;
    }
    try {
      await clockIn.mutateAsync();
      toast.success(t`Clocked in`);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not clock in`));
    }
  };

  // The hero is never hidden. While the hours are still loading, or if the
  // read failed, it is disabled WITH the reason — an operator who needs to
  // clock in must be able to see why they cannot, not find the button gone.
  const heroDisabledReason = query.isPending
    ? t`Loading your hours…`
    : screen
      ? undefined
      : t`Your hours could not be loaded, so this is not safe to press.`;

  return (
    <View className="flex-1 flex-row bg-background">
      <View className="flex-1">
        <Screen className="py-4">
          {/*
            The screen's own ScrollView rather than `Screen scroll`, for one
            reason: pull-to-refresh. On a tablet left on a bench the operator's
            instinct is to pull the list, and "did my clock-in land" is exactly
            the question they want answered on demand rather than at the next
            poll.
          */}
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-4 pb-8"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          >
            <Heading>
              <Trans>My Hours</Trans>
            </Heading>

            <WeekNav
              weekOffset={weekOffset}
              weekRange={weekRange}
              onChange={setWeekOffset}
            />

            {query.isPending ? (
              // A skeleton, never an empty screen: "still loading" and "you have
              // no hours this week" are different answers.
              <View className="gap-3">
                <Skeleton className="h-36" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </View>
            ) : screen ? (
              <>
                {query.isError ? (
                  <ErrorNote>
                    {commandMessage(
                      query.error,
                      t`Could not refresh your hours`
                    )}
                  </ErrorNote>
                ) : null}

                <TimecardSummary
                  openEntry={openEntry}
                  entries={screen.entries}
                  nowMs={nowMs}
                  timeZone={timeZone}
                  weekRange={weekRange}
                  isCurrentWeek={weekOffset === 0}
                />

                {groups.length ? (
                  <WeekEntries
                    groups={groups}
                    timeZone={timeZone}
                    nowMs={nowMs}
                  />
                ) : (
                  <EmptyState
                    title={t`No time entries for this week`}
                    description={t`Clock in and this week fills up.`}
                  />
                )}
              </>
            ) : (
              <View className="gap-3">
                <ErrorNote>
                  {commandMessage(query.error, t`Could not load your hours`)}
                </ErrorNote>
                <Button variant="secondary" onPress={() => query.refetch()}>
                  {t`Try again`}
                </Button>
              </View>
            )}
          </ScrollView>
        </Screen>
      </View>

      <ActionDock>
        <HeroButton
          icon={clockedIn ? Square : Play}
          label={clockedIn ? t`Clock Out` : t`Clock In`}
          tone={clockedIn ? "stop" : "start"}
          onPress={press}
          disabled={Boolean(heroDisabledReason)}
          loading={clockIn.isPending}
          disabledReason={heroDisabledReason}
        />
        <Button
          variant="ghost"
          onPress={() => moreSheet.current?.open()}
          accessibilityLabel={t`More actions`}
        >
          {t`More`}
        </Button>
      </ActionDock>

      <TimecardActionsSheet
        ref={moreSheet}
        onEndShift={() => {
          moreSheet.current?.close();
          setEndingShift(true);
        }}
      />

      {openEntry ? (
        <ClockOutDialog
          // Gated on THIS entry still being open, so a refetch that reveals
          // somebody else closed it takes the dialog away rather than leaving
          // a confirmation describing an entry that no longer exists.
          open={clockedIn && clockingOutId === openEntry.id}
          entry={openEntry}
          timeZone={timeZone}
          onClose={() => setClockingOutId(null)}
        />
      ) : null}

      <EndShiftDialog
        open={endingShift}
        openEntry={openEntry}
        operatorPinnedIn={Boolean(operatorToken)}
        onClose={() => setEndingShift(false)}
      />
    </View>
  );
}
