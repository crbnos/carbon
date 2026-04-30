import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
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
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useParams
} from "react-router";
import { Link } from "react-router-dom";
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
import { path } from "~/utils/path";

function getWeekBounds(offset: number = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    from: monday.toISOString(),
    to: sunday.toISOString(),
    monday,
    sunday
  };
}

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

function formatTime(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDay(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

/** Format a UTC date string to a local datetime-local input value */
function toLocalDatetimeInput(dateStr: string) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const url = new URL(request.url);
  const weekOffset = parseInt(url.searchParams.get("week") ?? "0", 10);
  const { from, to } = getWeekBounds(weekOffset);

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
    from,
    to,
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
): { clockIn: string; clockOut: string } | null {
  if (!shift) return null;
  // Parse YYYY-MM-DD as local date (not UTC)
  const [year, month, day2] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day2);
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
  ] as const;
  const day = dayNames[date.getDay()];
  if (!shift[day]) return null;

  const [startH, startM] = shift.startTime.split(":").map(Number);
  const [endH, endM] = shift.endTime.split(":").map(Number);

  const clockIn = new Date(date);
  clockIn.setHours(startH, startM, 0, 0);

  const clockOut = new Date(date);
  clockOut.setHours(endH, endM, 0, 0);
  if (clockOut <= clockIn) clockOut.setDate(clockOut.getDate() + 1);

  return {
    clockIn: toLocalDatetimeInput(clockIn.toISOString()),
    clockOut: toLocalDatetimeInput(clockOut.toISOString())
  };
}

export default function PersonTimecardRoute() {
  const { t } = useLingui();
  const { locale } = useLocale();
  const { formatDate } = useDateFormatter();
  const { entries, openEntry, weekOffset, from, to, shift } =
    useLoaderData<typeof loader>();
  const { personId } = useParams();
  const fetcher = useFetcher<typeof action>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editNote, setEditNote] = useState("");
  const [, setTick] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addClockIn, setAddClockIn] = useState("");
  const [addClockOut, setAddClockOut] = useState("");
  const [deletingEntry, setDeletingEntry] = useState<{
    id: string;
    clockIn: string;
  } | null>(null);

  // Update live durations every minute
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const monday = new Date(from);
  const sunday = new Date(to);
  const isCurrentWeek = weekOffset === 0;

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setEditingId(null);
      setShowAddForm(false);
    }
  }, [fetcher.data, fetcher.state]);

  // Auto-populate shift times when date is selected for new entry
  useEffect(() => {
    if (!addDate) return;
    const shiftTimes = getShiftTimesForDate(addDate, shift ?? null);
    if (shiftTimes) {
      setAddClockIn(shiftTimes.clockIn);
      setAddClockOut(shiftTimes.clockOut);
    } else {
      // No shift for this day, default 9am-5pm
      const [y, m, dy] = addDate.split("-").map(Number);
      const d = new Date(y, m - 1, dy);
      d.setHours(9, 0, 0, 0);
      setAddClockIn(toLocalDatetimeInput(d.toISOString()));
      d.setHours(17, 0, 0, 0);
      setAddClockOut(toLocalDatetimeInput(d.toISOString()));
    }
  }, [addDate, shift]);

  function startEdit(entry: {
    id: string;
    clockIn: string;
    clockOut: string | null;
    note: string | null;
  }) {
    setEditingId(entry.id);
    setEditClockIn(toLocalDatetimeInput(entry.clockIn));
    setEditClockOut(entry.clockOut ? toLocalDatetimeInput(entry.clockOut) : "");
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
                setAddClockIn("");
                setAddClockOut("");
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
              Clocked in since {formatTime(openEntry.clockIn, locale)}
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
            {formatDate(monday.toISOString(), { dateStyle: "medium" })} —{" "}
            {formatDate(sunday.toISOString(), { dateStyle: "medium" })}
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

        <TableBase className="table-fixed w-full">
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
              <Th>
                <Trans>Clock In</Trans>
              </Th>
              <Th>
                <Trans>Clock Out</Trans>
              </Th>
              <Th className="text-center">
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
                        const d = new Date(monday);
                        d.setDate(monday.getDate() + i);
                        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                        return (
                          <SelectItem key={val} value={val}>
                            {d.toLocaleDateString(locale, {
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
                  <Input
                    type="datetime-local"
                    value={addClockIn}
                    onChange={(e) => setAddClockIn(e.target.value)}
                    className="h-8 text-xs w-full [&::-webkit-calendar-picker-indicator]:hidden"
                  />
                </Td>
                <Td>
                  <Input
                    type="datetime-local"
                    value={addClockOut}
                    onChange={(e) => setAddClockOut(e.target.value)}
                    className="h-8 text-xs w-full [&::-webkit-calendar-picker-indicator]:hidden"
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
                        value={
                          isNaN(new Date(addClockIn).getTime())
                            ? ""
                            : new Date(addClockIn).toISOString()
                        }
                      />
                      {addClockOut &&
                        !isNaN(new Date(addClockOut).getTime()) && (
                          <input
                            type="hidden"
                            name="clockOut"
                            value={new Date(addClockOut).toISOString()}
                          />
                        )}
                      <Button
                        variant="secondary"
                        type="submit"
                        disabled={isNaN(new Date(addClockIn).getTime())}
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
                  className="text-center text-muted-foreground py-8"
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
                      <Input
                        type="datetime-local"
                        value={editClockIn}
                        onChange={(e) => setEditClockIn(e.target.value)}
                        className="h-8 text-xs w-full [&::-webkit-calendar-picker-indicator]:hidden"
                      />
                    </Td>
                    <Td>
                      <Input
                        type="datetime-local"
                        value={editClockOut}
                        onChange={(e) => setEditClockOut(e.target.value)}
                        className="h-8 text-xs w-full [&::-webkit-calendar-picker-indicator]:hidden"
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
                              isNaN(new Date(editClockIn).getTime())
                                ? ""
                                : new Date(editClockIn).toISOString()
                            }
                          />
                          {editClockOut &&
                            !isNaN(new Date(editClockOut).getTime()) && (
                              <input
                                type="hidden"
                                name="clockOut"
                                value={new Date(editClockOut).toISOString()}
                              />
                            )}
                          <input type="hidden" name="note" value={editNote} />
                          <Button
                            variant="secondary"
                            type="submit"
                            disabled={isNaN(new Date(editClockIn).getTime())}
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
                    <Td>{formatTime(entry.clockIn, locale)}</Td>
                    <Td>
                      {entry.clockOut ? (
                        formatTime(entry.clockOut, locale)
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
                          <DropdownMenuItem onClick={() => startEdit(entry)}>
                            <DropdownMenuIcon icon={<LuPencil />} />
                            <Trans>Edit</Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem
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
