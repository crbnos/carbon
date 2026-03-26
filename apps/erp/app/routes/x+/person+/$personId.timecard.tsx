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
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
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
import { formatDate } from "@carbon/utils";
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
import {
  clockIn,
  clockInValidator,
  clockOut,
  clockOutValidator,
  createTimeCardBreak,
  deleteTimeCardBreak,
  deleteTimeCardBreakValidator,
  deleteTimeCardEntry,
  deleteTimeCardEntryValidator,
  getOpenClockEntry,
  getTimeCardBreaks,
  getTimeCardEntries,
  getWeeklyTimecardSummary,
  updateTimeCardBreak,
  updateTimeCardBreakValidator,
  updateTimeCardEntry,
  updateTimeCardEntryValidator
} from "~/modules/people";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

function getWeekBounds(offset = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay();
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

function formatDuration(startTime: string, endTime: string | null) {
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  const ms = end - new Date(startTime).getTime();
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

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDay(dateStr: string) {
  return new Date(dateStr).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function toLocalDatetimeInput(dateStr: string) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatMinutes(totalMinutes: number | null) {
  if (totalMinutes === null) return "—";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatAverageClock(minutes: number | null) {
  if (minutes === null) return "—";
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getAnomalyDescription(
  summary: {
    missedPunchCount: number;
    openEntryCount?: number;
    openBreakCount?: number;
  } | null
) {
  if (!summary || summary.missedPunchCount === 0) {
    return "No anomalies detected this week.";
  }

  const parts: string[] = [];
  if ((summary.openEntryCount ?? 0) > 0) {
    parts.push(
      `${summary.openEntryCount} open shift${summary.openEntryCount === 1 ? "" : "s"}`
    );
  }
  if ((summary.openBreakCount ?? 0) > 0) {
    parts.push(
      `${summary.openBreakCount} open break${summary.openBreakCount === 1 ? "" : "s"}`
    );
  }

  return parts.length > 0
    ? `Anomalies: ${parts.join(", ")}.`
    : `${summary.missedPunchCount} anomaly flag${summary.missedPunchCount === 1 ? "" : "s"} detected.`;
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

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const url = new URL(request.url);
  const weekOffset = parseInt(url.searchParams.get("week") ?? "0", 10);
  const { from, to } = getWeekBounds(weekOffset);

  const [entries, breaks, openEntry, companySettings, employeeShift, summary] =
    await Promise.all([
      getTimeCardEntries(client, {
        employeeId: personId,
        companyId,
        from,
        to
      }),
      getTimeCardBreaks(client, {
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
        .maybeSingle(),
      getWeeklyTimecardSummary(client, {
        companyId,
        employeeId: personId,
        weekStart: from
      })
    ]);

  if (!companySettings.data?.timeCardEnabled) {
    throw redirect(path.to.personDetails(personId));
  }

  return {
    entries: entries.data ?? [],
    breaks: breaks.data ?? [],
    openEntry: openEntry.data,
    weekOffset,
    from,
    to,
    shift: employeeShift?.data?.shift ?? null,
    summary: summary[0] ?? null
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

  if (intent === "updateBreak") {
    const validation = await validator(updateTimeCardBreakValidator).validate(
      formData
    );
    if (validation.error) return data({}, { status: 400 });

    const result = await updateTimeCardBreak(client, {
      breakId: validation.data.breakId,
      breakType: validation.data.breakType,
      startTime: validation.data.startTime,
      endTime: validation.data.endTime || null,
      note: validation.data.note || null,
      endedBy: userId
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to update break"))
      );
    }
    return data({}, await flash(request, success("Break updated")));
  }

  if (intent === "deleteBreak") {
    const validation = await validator(deleteTimeCardBreakValidator).validate(
      formData
    );
    if (validation.error) return data({}, { status: 400 });

    const result = await deleteTimeCardBreak(client, validation.data.breakId);
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to delete break"))
      );
    }
    return data({}, await flash(request, success("Break deleted")));
  }

  if (intent === "addBreak") {
    const breakType =
      (formData.get("breakType") as "Break" | "Lunch" | null) ?? "Break";
    const startTime = formData.get("startTime") as string;
    const endTime = (formData.get("endTime") as string | null) || null;
    const note = (formData.get("note") as string | null) || null;

    if (!startTime) return data({}, { status: 400 });

    const result = await createTimeCardBreak(client, {
      employeeId: personId,
      companyId,
      breakType,
      startTime,
      endTime,
      note,
      startedBy: userId,
      endedBy: endTime ? userId : null
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to add break"))
      );
    }
    return data({}, await flash(request, success("Break added")));
  }

  return data({}, { status: 400 });
}

export default function PersonTimecardRoute() {
  const { entries, breaks, openEntry, weekOffset, from, to, shift, summary } =
    useLoaderData<typeof loader>();
  const { personId } = useParams();
  const fetcher = useFetcher<typeof action>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBreakId, setEditingBreakId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddBreakForm, setShowAddBreakForm] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addClockIn, setAddClockIn] = useState("");
  const [addClockOut, setAddClockOut] = useState("");
  const [addBreakType, setAddBreakType] = useState<"Break" | "Lunch">("Break");
  const [addBreakStart, setAddBreakStart] = useState("");
  const [addBreakEnd, setAddBreakEnd] = useState("");
  const [editBreakType, setEditBreakType] = useState<"Break" | "Lunch">(
    "Break"
  );
  const [editBreakStart, setEditBreakStart] = useState("");
  const [editBreakEnd, setEditBreakEnd] = useState("");
  const [, setTick] = useState(0);
  const [deletingEntry, setDeletingEntry] = useState<{
    id: string;
    clockIn: string;
  } | null>(null);
  const [deletingBreak, setDeletingBreak] = useState<{
    id: string;
    startTime: string;
  } | null>(null);

  const monday = new Date(from);
  const sunday = new Date(to);
  const isCurrentWeek = weekOffset === 0;

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setEditingId(null);
      setEditingBreakId(null);
      setShowAddForm(false);
      setShowAddBreakForm(false);
    }
  }, [fetcher.data, fetcher.state]);

  useEffect(() => {
    if (!addDate) return;
    const shiftTimes = getShiftTimesForDate(addDate, shift ?? null);
    if (shiftTimes) {
      setAddClockIn(shiftTimes.clockIn);
      setAddClockOut(shiftTimes.clockOut);
      setAddBreakStart(shiftTimes.clockIn);
      setAddBreakEnd(shiftTimes.clockOut);
    }
  }, [addDate, shift]);

  function startEdit(entry: {
    id: string;
    clockIn: string;
    clockOut: string | null;
  }) {
    setEditingId(entry.id);
    setEditClockIn(toLocalDatetimeInput(entry.clockIn));
    setEditClockOut(entry.clockOut ? toLocalDatetimeInput(entry.clockOut) : "");
  }

  function startEditBreak(timecardBreak: {
    id: string;
    breakType: "Break" | "Lunch";
    startTime: string;
    endTime: string | null;
  }) {
    setEditingBreakId(timecardBreak.id);
    setEditBreakType(timecardBreak.breakType);
    setEditBreakStart(toLocalDatetimeInput(timecardBreak.startTime));
    setEditBreakEnd(
      timecardBreak.endTime ? toLocalDatetimeInput(timecardBreak.endTime) : ""
    );
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader>
          <HStack className="justify-between items-center">
            <CardTitle>Timecards</CardTitle>
            <HStack className="gap-1">
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                onClick={() => {
                  setShowAddForm(!showAddForm);
                  setAddDate("");
                }}
              >
                Add Entry
              </Button>
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                onClick={() => {
                  setShowAddBreakForm(!showAddBreakForm);
                  setAddDate("");
                }}
              >
                Add Break
              </Button>
              {openEntry ? (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="clockOut" />
                  <Button
                    variant="destructive"
                    type="submit"
                    disabled={fetcher.state !== "idle"}
                  >
                    Clock Out
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
                    Clock In
                  </Button>
                </fetcher.Form>
              )}
            </HStack>
          </HStack>
          {openEntry && (
            <Badge variant="green" className="w-fit">
              Clocked in since {formatTime(openEntry.clockIn)}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <HStack className="justify-between items-center mb-4">
            <Button variant="outline" asChild leftIcon={<LuChevronLeft />}>
              <Link
                to={`${path.to.personTimecard(personId!)}?week=${weekOffset - 1}`}
              >
                Prev
              </Link>
            </Button>
            <span className="text-sm text-muted-foreground">
              {formatDate(monday.toISOString(), { dateStyle: "medium" })} -{" "}
              {formatDate(sunday.toISOString(), { dateStyle: "medium" })}
            </span>
            <Button
              variant="outline"
              disabled={isCurrentWeek}
              asChild={!isCurrentWeek}
              rightIcon={<LuChevronRight />}
            >
              {isCurrentWeek ? (
                <span>Next</span>
              ) : (
                <Link
                  to={`${path.to.personTimecard(personId!)}?week=${weekOffset + 1}`}
                >
                  Next
                </Link>
              )}
            </Button>
          </HStack>

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Worked</CardTitle>
              </CardHeader>
              <CardContent>
                {formatMinutes(summary?.totalWorkedMinutes ?? 0)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Regular</CardTitle>
              </CardHeader>
              <CardContent>
                {formatMinutes(summary?.regularMinutes ?? 0)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Overtime</CardTitle>
              </CardHeader>
              <CardContent>
                {formatMinutes(summary?.overtimeMinutes ?? 0)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Break Time</CardTitle>
              </CardHeader>
              <CardContent>
                {formatMinutes(summary?.breakMinutes ?? 0)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Avg First Punch</CardTitle>
              </CardHeader>
              <CardContent>
                {formatAverageClock(summary?.averageFirstPunchMinutes ?? null)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Anomalies</CardTitle>
              </CardHeader>
              <CardContent
                title={getAnomalyDescription(summary)}
                aria-label={getAnomalyDescription(summary)}
              >
                {summary?.missedPunchCount ?? 0}
              </CardContent>
            </Card>
          </div>

          <TableBase className="table-fixed w-full">
            <Thead>
              <Tr>
                <Th>Date</Th>
                <Th>Clock In</Th>
                <Th>Clock Out</Th>
                <Th className="text-center">Duration</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {showAddForm && (
                <Tr>
                  <Td>
                    <Select value={addDate} onValueChange={setAddDate}>
                      <SelectTrigger size="sm">
                        <SelectValue placeholder="Date" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 7 }, (_, i) => {
                          const d = new Date(monday);
                          d.setDate(monday.getDate() + i);
                          const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                          return (
                            <SelectItem key={val} value={val}>
                              {d.toLocaleDateString([], {
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
                      className="h-8 text-xs w-full"
                    />
                  </Td>
                  <Td>
                    <Input
                      type="datetime-local"
                      value={addClockOut}
                      onChange={(e) => setAddClockOut(e.target.value)}
                      className="h-8 text-xs w-full"
                    />
                  </Td>
                  <Td className="text-center text-muted-foreground">—</Td>
                  <Td className="text-right">
                    <HStack className="justify-end">
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
                        <Button variant="secondary" type="submit">
                          Save
                        </Button>
                      </fetcher.Form>
                      <Button
                        variant="ghost"
                        onClick={() => setShowAddForm(false)}
                      >
                        Cancel
                      </Button>
                    </HStack>
                  </Td>
                </Tr>
              )}

              {entries.length === 0 ? (
                <Tr>
                  <Td
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    No time entries for this week
                  </Td>
                </Tr>
              ) : (
                entries.map((entry) =>
                  editingId === entry.id ? (
                    <Tr key={entry.id}>
                      <Td>{formatDay(entry.clockIn)}</Td>
                      <Td>
                        <Input
                          type="datetime-local"
                          value={editClockIn}
                          onChange={(e) => setEditClockIn(e.target.value)}
                          className="h-8 text-xs w-full"
                        />
                      </Td>
                      <Td>
                        <Input
                          type="datetime-local"
                          value={editClockOut}
                          onChange={(e) => setEditClockOut(e.target.value)}
                          className="h-8 text-xs w-full"
                        />
                      </Td>
                      <Td className="text-center text-muted-foreground">—</Td>
                      <Td className="text-right">
                        <HStack className="justify-end">
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
                              value={new Date(editClockIn).toISOString()}
                            />
                            {editClockOut && (
                              <input
                                type="hidden"
                                name="clockOut"
                                value={new Date(editClockOut).toISOString()}
                              />
                            )}
                            <Button variant="secondary" type="submit">
                              Save
                            </Button>
                          </fetcher.Form>
                          <Button
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                        </HStack>
                      </Td>
                    </Tr>
                  ) : (
                    <Tr key={entry.id}>
                      <Td>{formatDay(entry.clockIn)}</Td>
                      <Td>{formatTime(entry.clockIn)}</Td>
                      <Td>
                        {entry.clockOut ? (
                          formatTime(entry.clockOut)
                        ) : (
                          <Badge variant="green">Active</Badge>
                        )}
                      </Td>
                      <Td className="text-center">
                        {formatDuration(entry.clockIn, entry.clockOut)}
                      </Td>
                      <Td className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label="More options"
                              variant="ghost"
                              icon={<LuEllipsisVertical />}
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => startEdit(entry)}>
                              <DropdownMenuIcon icon={<LuPencil />} />
                              Edit
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
                              Delete
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
              Total: {formatTotalHours(entries)}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Breaks</CardTitle>
        </CardHeader>
        <CardContent>
          <TableBase className="table-fixed w-full">
            <Thead>
              <Tr>
                <Th>Type</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th className="text-center">Duration</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {showAddBreakForm && (
                <Tr>
                  <Td>
                    <Select
                      value={addBreakType}
                      onValueChange={(value) =>
                        setAddBreakType(value as "Break" | "Lunch")
                      }
                    >
                      <SelectTrigger size="sm">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Break">Break</SelectItem>
                        <SelectItem value="Lunch">Lunch</SelectItem>
                      </SelectContent>
                    </Select>
                  </Td>
                  <Td>
                    <Input
                      type="datetime-local"
                      value={addBreakStart}
                      onChange={(e) => setAddBreakStart(e.target.value)}
                      className="h-8 text-xs w-full"
                    />
                  </Td>
                  <Td>
                    <Input
                      type="datetime-local"
                      value={addBreakEnd}
                      onChange={(e) => setAddBreakEnd(e.target.value)}
                      className="h-8 text-xs w-full"
                    />
                  </Td>
                  <Td className="text-center text-muted-foreground">—</Td>
                  <Td className="text-right">
                    <HStack className="justify-end">
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="addBreak" />
                        <input
                          type="hidden"
                          name="breakType"
                          value={addBreakType}
                        />
                        <input
                          type="hidden"
                          name="startTime"
                          value={new Date(addBreakStart).toISOString()}
                        />
                        {addBreakEnd && (
                          <input
                            type="hidden"
                            name="endTime"
                            value={new Date(addBreakEnd).toISOString()}
                          />
                        )}
                        <Button variant="secondary" type="submit">
                          Save
                        </Button>
                      </fetcher.Form>
                      <Button
                        variant="ghost"
                        onClick={() => setShowAddBreakForm(false)}
                      >
                        Cancel
                      </Button>
                    </HStack>
                  </Td>
                </Tr>
              )}

              {breaks.length === 0 ? (
                <Tr>
                  <Td
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    No breaks recorded this week
                  </Td>
                </Tr>
              ) : (
                breaks.map((timecardBreak) =>
                  editingBreakId === timecardBreak.id ? (
                    <Tr key={timecardBreak.id}>
                      <Td>
                        <Select
                          value={editBreakType}
                          onValueChange={(value) =>
                            setEditBreakType(value as "Break" | "Lunch")
                          }
                        >
                          <SelectTrigger size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Break">Break</SelectItem>
                            <SelectItem value="Lunch">Lunch</SelectItem>
                          </SelectContent>
                        </Select>
                      </Td>
                      <Td>
                        <Input
                          type="datetime-local"
                          value={editBreakStart}
                          onChange={(e) => setEditBreakStart(e.target.value)}
                          className="h-8 text-xs w-full"
                        />
                      </Td>
                      <Td>
                        <Input
                          type="datetime-local"
                          value={editBreakEnd}
                          onChange={(e) => setEditBreakEnd(e.target.value)}
                          className="h-8 text-xs w-full"
                        />
                      </Td>
                      <Td className="text-center text-muted-foreground">—</Td>
                      <Td className="text-right">
                        <HStack className="justify-end">
                          <fetcher.Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="updateBreak"
                            />
                            <input
                              type="hidden"
                              name="breakId"
                              value={timecardBreak.id}
                            />
                            <input
                              type="hidden"
                              name="breakType"
                              value={editBreakType}
                            />
                            <input
                              type="hidden"
                              name="startTime"
                              value={new Date(editBreakStart).toISOString()}
                            />
                            {editBreakEnd && (
                              <input
                                type="hidden"
                                name="endTime"
                                value={new Date(editBreakEnd).toISOString()}
                              />
                            )}
                            <Button variant="secondary" type="submit">
                              Save
                            </Button>
                          </fetcher.Form>
                          <Button
                            variant="ghost"
                            onClick={() => setEditingBreakId(null)}
                          >
                            Cancel
                          </Button>
                        </HStack>
                      </Td>
                    </Tr>
                  ) : (
                    <Tr key={timecardBreak.id}>
                      <Td>
                        <Badge
                          variant={
                            timecardBreak.breakType === "Lunch"
                              ? "yellow"
                              : "secondary"
                          }
                        >
                          {timecardBreak.breakType}
                        </Badge>
                      </Td>
                      <Td>
                        {formatDay(timecardBreak.startTime)}{" "}
                        {formatTime(timecardBreak.startTime)}
                      </Td>
                      <Td>
                        {timecardBreak.endTime ? (
                          formatTime(timecardBreak.endTime)
                        ) : (
                          <Badge variant="yellow">Open</Badge>
                        )}
                      </Td>
                      <Td className="text-center">
                        {formatDuration(
                          timecardBreak.startTime,
                          timecardBreak.endTime
                        )}
                      </Td>
                      <Td className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label="More options"
                              variant="ghost"
                              icon={<LuEllipsisVertical />}
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => startEditBreak(timecardBreak)}
                            >
                              <DropdownMenuIcon icon={<LuPencil />} />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                setDeletingBreak({
                                  id: timecardBreak.id,
                                  startTime: timecardBreak.startTime
                                })
                              }
                              className="text-destructive"
                            >
                              <DropdownMenuIcon icon={<LuTrash />} />
                              Delete
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
        </CardContent>
      </Card>

      {deletingEntry && (
        <Modal open onOpenChange={(open) => !open && setDeletingEntry(null)}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                Delete Timecard (
                {new Date(deletingEntry.clockIn).toLocaleString()})
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              Are you sure you want to delete this timecard?
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setDeletingEntry(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const formData = new FormData();
                  formData.append("intent", "deleteEntry");
                  formData.append("entryId", deletingEntry.id);
                  fetcher.submit(formData, { method: "post" });
                  setDeletingEntry(null);
                }}
              >
                Delete
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {deletingBreak && (
        <Modal open onOpenChange={(open) => !open && setDeletingBreak(null)}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                Delete Break (
                {new Date(deletingBreak.startTime).toLocaleString()})
              </ModalTitle>
            </ModalHeader>
            <ModalBody>Are you sure you want to delete this break?</ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setDeletingBreak(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const formData = new FormData();
                  formData.append("intent", "deleteBreak");
                  formData.append("breakId", deletingBreak.id);
                  fetcher.submit(formData, { method: "post" });
                  setDeletingBreak(null);
                }}
              >
                Delete
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </div>
  );
}
