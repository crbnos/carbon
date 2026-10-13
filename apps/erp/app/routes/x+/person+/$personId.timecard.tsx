// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateTimePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import {
  datetime,
  fromLocalDateTime,
  redirect,
  toLocalDateTime
} from "@carbon/utils";
import type { CalendarDateTime } from "@internationalized/date";
import {
  getDayOfWeek,
  parseDate,
  Time,
  toCalendarDateTime
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuEllipsisVertical,
  LuPencil,
  LuPlay,
  LuPlus,
  LuTrash
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useLoaderData, useParams } from "react-router";
import { DateTime } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter } from "~/hooks";
import {
  clockIn,
  clockInValidator,
  clockOut,
  clockOutValidator,
  deleteTimeCardEntry,
  deleteTimeCardEntryValidator,
  getOpenClockEntry,
  getTimeCardEntries,
  updateTimeCardEntry,
  updateTimeCardEntryValidator
} from "~/modules/people";
import { getCompanySettings } from "~/modules/settings";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

function formatDuration(clockIn: string, clockOut: string | null) {
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  const ms = end - new Date(clockIn).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatTotalHours(
  entries: { clockIn: string; clockOut: string | null }[]
) {
  let totalMs = 0;
  for (const entry of entries) {
    const end = entry.clockOut
      ? new Date(entry.clockOut).getTime()
      : Date.now();
    totalMs += end - new Date(entry.clockIn).getTime();
  }
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatDay(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const url = new URL(request.url);
  const weekOffset = parseInt(url.searchParams.get("week") ?? "0", 10);
  // Week runs Monday → Sunday on the company calendar (one payroll boundary
  // per books, not the server's zone).
  const tz = await getCompanyTimeZone(client, companyId);
  const { from, to } = datetime.weekBounds(tz, weekOffset);
  // Calendar days of the window on the COMPANY calendar — the client renders
  // these directly so the header and day picker never shift a day in a
  // different browser tz.
  const weekStart = datetime.businessDay(from, tz).toString();
  const weekEnd = datetime.businessDay(to, tz).toString();

  const [entries, openEntry, companySettings, employeeShift] =
    await Promise.all([
      getTimeCardEntries(client, {
        employeeId: personId,
        companyId,
        from,
        to
      }),
      getOpenClockEntry(client, personId, companyId),
      getCompanySettings(client, companyId),
      client
        .from("employeeJob")
        .select(
          "shiftId, shift:shift(startTime, endTime, sunday, monday, tuesday, wednesday, thursday, friday, saturday)"
        )
        .eq("id", personId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);

  if (!companySettings.data?.timeCardEnabled) {
    throw redirect(path.to.personDetails(personId));
  }

  const shift = employeeShift?.data?.shift as {
    startTime: string;
    endTime: string;
    sunday: boolean;
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
  } | null;

  return {
    entries: entries.data ?? [],
    openEntry: openEntry.data,
    weekOffset,
    weekStart,
    weekEnd,
    shift
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("No person ID provided");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const validation = await validator(clockInValidator).validate(formData);
    if (validation.error) return data({}, { status: 400 });

    const employeeId = validation.data.employeeId || personId;
    const result = await clockIn(client, {
      employeeId,
      companyId,
      createdBy: userId
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, result.error.message))
      );
    }
    return data({}, await flash(request, success("Clocked in")));
  }

  if (intent === "clockOut") {
    const validation = await validator(clockOutValidator).validate(formData);
    if (validation.error) return data({}, { status: 400 });

    const employeeId = validation.data.employeeId || personId;
    const result = await clockOut(client, {
      employeeId,
      companyId,
      updatedBy: userId,
      note: validation.data.note
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, result.error.message))
      );
    }
    return data({}, await flash(request, success("Clocked out")));
  }

  if (intent === "updateEntry") {
    const validation = await validator(updateTimeCardEntryValidator).validate(
      formData
    );
    if (validation.error) return data({}, { status: 400 });

    const result = await updateTimeCardEntry(client, {
      entryId: validation.data.entryId,
      clockIn: validation.data.clockIn,
      clockOut: validation.data.clockOut || null,
      note: validation.data.note || null,
      updatedBy: userId
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to update entry"))
      );
    }
    return data({}, await flash(request, success("Entry updated")));
  }

  if (intent === "deleteEntry") {
    const validation = await validator(deleteTimeCardEntryValidator).validate(
      formData
    );
    if (validation.error) return data({}, { status: 400 });

    const result = await deleteTimeCardEntry(client, validation.data.entryId);
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to delete entry"))
      );
    }
    return data({}, await flash(request, success("Entry deleted")));
  }

  if (intent === "addEntry") {
    const clockInVal = formData.get("clockIn") as string;
    const clockOutVal = formData.get("clockOut") as string | null;
    if (!clockInVal) return data({}, { status: 400 });

    const result = await client.from("timeCardEntry").insert({
      employeeId: personId,
      companyId,
      clockIn: clockInVal,
      clockOut: clockOutVal || null,
      createdBy: userId
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to add entry"))
      );
    }
    return data({}, await flash(request, success("Entry added")));
  }

  return data({}, { status: 400 });
}

function getShiftTimesForDate(
  dateStr: string,
  shift: {
    startTime: string;
    endTime: string;
    sunday: boolean;
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
  } | null
): { clockIn: CalendarDateTime; clockOut: CalendarDateTime } | null {
  if (!shift) return null;
  const date = parseDate(dateStr);
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
  ] as const;
  const day = dayNames[getDayOfWeek(date, "en-US")];
  if (!shift[day]) return null;

  const [startH, startM] = shift.startTime.split(":").map(Number);
  const [endH, endM] = shift.endTime.split(":").map(Number);

  const clockIn = toCalendarDateTime(date, new Time(startH, startM));
  let clockOut = toCalendarDateTime(date, new Time(endH, endM));
  if (clockOut.compare(clockIn) <= 0) clockOut = clockOut.add({ days: 1 });

  return { clockIn, clockOut };
}

export default function PersonTimecardRoute() {
  const { t } = useLingui();
  const { locale } = useLocale();
  const { formatDate } = useDateFormatter();
  const { entries, openEntry, weekOffset, weekStart, weekEnd, shift } =
    useLoaderData<typeof loader>();
  const { personId } = useParams();
  const fetcher = useAction<typeof action>({
    onSettled: (data) => {
      if (data) {
        setEditingId(null);
        setShowAddForm(false);
      }
    }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState<CalendarDateTime | null>(null);
  const [editClockOut, setEditClockOut] = useState<CalendarDateTime | null>(
    null
  );
  const [editNote, setEditNote] = useState("");
  const [, setTick] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addClockIn, setAddClockIn] = useState<CalendarDateTime | null>(null);
  const [addClockOut, setAddClockOut] = useState<CalendarDateTime | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<{
    id: string;
    clockIn: string;
  } | null>(null);

  // Update live durations every minute
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const isCurrentWeek = weekOffset === 0;

  // Auto-populate shift times when date is selected for new entry
  useEffect(() => {
    if (!addDate) return;
    const shiftTimes = getShiftTimesForDate(addDate, shift ?? null);
    if (shiftTimes) {
      setAddClockIn(shiftTimes.clockIn);
      setAddClockOut(shiftTimes.clockOut);
    } else {
      // No shift for this day, default 9am-5pm
      const date = parseDate(addDate);
      setAddClockIn(toCalendarDateTime(date, new Time(9)));
      setAddClockOut(toCalendarDateTime(date, new Time(17)));
    }
  }, [addDate, shift]);

  function startEdit(entry: {
    id: string;
    clockIn: string;
    clockOut: string | null;
    note: string | null;
  }) {
    setEditingId(entry.id);
    setEditClockIn(toLocalDateTime(entry.clockIn));
    setEditClockOut(entry.clockOut ? toLocalDateTime(entry.clockOut) : null);
    setEditNote(entry.note ?? "");
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <HStack className="justify-between items-center">
          <CardTitle>
            <Trans>Timecards</Trans>
          </CardTitle>
          <HStack className="gap-1">
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              onClick={() => {
                setShowAddForm(!showAddForm);
                setAddDate("");
                setAddClockIn(null);
                setAddClockOut(null);
              }}
            >
              <Trans>Add Entry</Trans>
            </Button>
            {openEntry ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="clockOut" />
                <Button
                  variant="destructive"
                  type="submit"
                  disabled={fetcher.state !== "idle"}
                >
                  <Trans>Clock Out</Trans>
                </Button>
              </fetcher.Form>
            ) : (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="clockIn" />
                <Button
                  leftIcon={<LuPlay />}
                  type="submit"
                  disabled={fetcher.state !== "idle"}
                >
                  <Trans>Clock In</Trans>
                </Button>
              </fetcher.Form>
            )}
          </HStack>
        </HStack>
        {openEntry && (
          <Badge variant="green" className="w-fit">
            <Trans>
              Clocked in since{" "}
              <DateTime value={openEntry.clockIn} variant="time" />
            </Trans>
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <HStack className="justify-between items-center mb-4">
          <Button variant="outline" asChild leftIcon={<LuChevronLeft />}>
            <Link
              to={`${path.to.personTimecard(personId!)}?week=${weekOffset - 1}`}
            >
              <Trans>Prev</Trans>
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            <DateTime
              value={weekStart}
              variant="date"
              dateOptions={{ dateStyle: "medium" }}
            />{" "}
            —{" "}
            <DateTime
              value={weekEnd}
              variant="date"
              dateOptions={{ dateStyle: "medium" }}
            />
          </span>
          <Button
            variant="outline"
            disabled={isCurrentWeek}
            asChild={!isCurrentWeek}
            rightIcon={<LuChevronRight />}
          >
            {isCurrentWeek ? (
              <span>
                <Trans>Next</Trans>
              </span>
            ) : (
              <Link
                to={`${path.to.personTimecard(personId!)}?week=${weekOffset + 1}`}
              >
                <Trans>Next</Trans>
              </Link>
            )}
          </Button>
        </HStack>

        <TableBase className="table-fixed w-full max-md:table-auto max-md:min-w-[36rem]">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[28%]" />
            <col className="w-[28%]" />
            <col className="w-[12%]" />
            <col className="w-[16%]" />
          </colgroup>
          <Thead>
            <Tr>
              <Th className="whitespace-nowrap">
                <Trans>Date</Trans>
              </Th>
              <Th className="max-md:whitespace-nowrap">
                <Trans>Clock In</Trans>
              </Th>
              <Th className="max-md:whitespace-nowrap">
                <Trans>Clock Out</Trans>
              </Th>
              <Th className="text-center max-md:whitespace-nowrap">
                <Trans>Duration</Trans>
              </Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {showAddForm && (
              <Tr>
                <Td>
                  <Select
                    value={addDate}
                    onValueChange={(value) => setAddDate(value)}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder={t`Date`} />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 7 }, (_, i) => {
                        const val = parseDate(weekStart)
                          .add({ days: i })
                          .toString();
                        return (
                          <SelectItem key={val} value={val}>
                            {formatDate(val, {
                              weekday: "short",
                              month: "short",
                              day: "numeric"
                            })}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </Td>
                <Td>
                  <DateTimePicker
                    aria-label={t`Clock In`}
                    size="sm"
                    value={addClockIn}
                    onChange={(value) =>
                      setAddClockIn(value ? toCalendarDateTime(value) : null)
                    }
                  />
                </Td>
                <Td>
                  <DateTimePicker
                    aria-label={t`Clock Out`}
                    size="sm"
                    value={addClockOut}
                    onChange={(value) =>
                      setAddClockOut(value ? toCalendarDateTime(value) : null)
                    }
                  />
                </Td>
                <Td className="text-muted-foreground text-center">—</Td>
                <Td className="text-center">
                  <HStack className="justify-center">
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="addEntry" />
                      <input
                        type="hidden"
                        name="clockIn"
                        value={addClockIn ? fromLocalDateTime(addClockIn) : ""}
                      />
                      {addClockOut && (
                        <input
                          type="hidden"
                          name="clockOut"
                          value={fromLocalDateTime(addClockOut)}
                        />
                      )}
                      <Button
                        isLoading={fetcher.state !== "idle"}
                        variant="secondary"
                        type="submit"
                        disabled={!addClockIn}
                      >
                        <Trans>Save</Trans>
                      </Button>
                    </fetcher.Form>
                    <Button
                      variant="ghost"
                      onClick={() => setShowAddForm(false)}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                  </HStack>
                </Td>
              </Tr>
            )}
            {entries.length === 0 && !showAddForm ? (
              <Tr>
                <Td
                  colSpan={5}
                  className="text-center text-muted-foreground py-8 max-md:text-left"
                >
                  <Trans>No time entries for this week</Trans>
                </Td>
              </Tr>
            ) : (
              entries.map((entry) =>
                editingId === entry.id ? (
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap">
                      {formatDay(entry.clockIn, locale)}
                    </Td>
                    <Td>
                      <DateTimePicker
                        aria-label={t`Clock In`}
                        size="sm"
                        value={editClockIn}
                        onChange={(value) =>
                          setEditClockIn(
                            value ? toCalendarDateTime(value) : null
                          )
                        }
                      />
                    </Td>
                    <Td>
                      <DateTimePicker
                        aria-label={t`Clock Out`}
                        size="sm"
                        value={editClockOut}
                        onChange={(value) =>
                          setEditClockOut(
                            value ? toCalendarDateTime(value) : null
                          )
                        }
                      />
                    </Td>
                    <Td className="text-muted-foreground text-center">—</Td>
                    <Td className="text-center">
                      <HStack className="justify-center">
                        <fetcher.Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="updateEntry"
                          />
                          <input
                            type="hidden"
                            name="entryId"
                            value={entry.id}
                          />
                          <input
                            type="hidden"
                            name="clockIn"
                            value={
                              editClockIn ? fromLocalDateTime(editClockIn) : ""
                            }
                          />
                          {editClockOut && (
                            <input
                              type="hidden"
                              name="clockOut"
                              value={fromLocalDateTime(editClockOut)}
                            />
                          )}
                          <input type="hidden" name="note" value={editNote} />
                          <Button
                            isLoading={fetcher.state !== "idle"}
                            variant="secondary"
                            type="submit"
                            disabled={!editClockIn}
                          >
                            <Trans>Save</Trans>
                          </Button>
                        </fetcher.Form>
                        <Button
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          <Trans>Cancel</Trans>
                        </Button>
                      </HStack>
                    </Td>
                  </Tr>
                ) : (
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap">
                      {formatDay(entry.clockIn, locale)}
                    </Td>
                    <Td>
                      <DateTime value={entry.clockIn} variant="time" />
                    </Td>
                    <Td>
                      {entry.clockOut ? (
                        <DateTime value={entry.clockOut} variant="time" />
                      ) : (
                        <Badge variant="green">
                          <Trans>Active</Trans>
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-center">
                      {formatDuration(entry.clockIn, entry.clockOut)}
                    </Td>
                    <Td className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label={t`More options`}
                            variant="ghost"
                            icon={<LuEllipsisVertical />}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            shortcut={MENU_ITEM_SHORTCUTS.edit}
                            onClick={() => startEdit(entry)}
                          >
                            <DropdownMenuIcon icon={<LuPencil />} />
                            <Trans>Edit</Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            shortcut={MENU_ITEM_SHORTCUTS.delete}
                            onClick={() =>
                              setDeletingEntry({
                                id: entry.id,
                                clockIn: entry.clockIn
                              })
                            }
                            className="text-destructive"
                          >
                            <DropdownMenuIcon icon={<LuTrash />} />
                            <Trans>Delete</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Td>
                  </Tr>
                )
              )
            )}
          </Tbody>
        </TableBase>

        {entries.length > 0 && (
          <div className="mt-4 text-right text-sm font-medium">
            <Trans>Total:</Trans> {formatTotalHours(entries)}
          </div>
        )}
      </CardContent>
      {deletingEntry && (
        <ConfirmDelete
          name={`Timecard (${new Date(deletingEntry.clockIn).toLocaleString(locale)})`}
          text={t`Are you sure you want to delete this timecard? This cannot be undone.`}
          onCancel={() => setDeletingEntry(null)}
          onSubmit={() => {
            const formData = new FormData();
            formData.append("intent", "deleteEntry");
            formData.append("entryId", deletingEntry.id);
            fetcher.submit(formData, { method: "post" });
            setDeletingEntry(null);
          }}
        />
      )}
    </Card>
  );
}
