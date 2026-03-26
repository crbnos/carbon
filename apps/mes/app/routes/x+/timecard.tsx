import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { getLocalTimeZone } from "@internationalized/date";
import { useEffect, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuPause,
  LuPlay,
  LuTriangleAlert
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import {
  endOpenBreakOnLogin,
  ensureDailyAutoClockIn,
  getOpenClockEntry,
  getOpenTimeCardBreak,
  getTimeCardBreaks,
  getWeeklyTimecardSummary
} from "~/services/people.service";
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

function formatDuration(clockInStr: string, clockOutStr: string | null) {
  const end = clockOutStr ? new Date(clockOutStr).getTime() : Date.now();
  const ms = end - new Date(clockInStr).getTime();
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

function formatMinutes(totalMinutes: number | null) {
  if (totalMinutes === null) return "--";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatAverageClock(minutes: number | null) {
  if (minutes === null) return "--";
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getBreakWarningMessage({
  openBreak,
  openEntry
}: {
  openBreak: { startTime: string } | null;
  openEntry: { clockIn: string } | null;
}) {
  if (!openBreak) return null;

  if (openEntry) {
    return "Your account shows both an active shift and an active break. Treat this as unpaid break time until it is fixed. Resume paid work now or contact your supervisor immediately.";
  }

  return "Your break is still active. You are not being paid again until you end the break and resume work.";
}

function getAverageFirstPunchMinutes(
  entries: { clockIn: string; clockOut: string | null }[]
) {
  const firstPunchByDay = new Map<string, number>();

  for (const entry of entries) {
    const date = new Date(entry.clockIn);
    const dayKey = date.toLocaleDateString("en-CA");
    const minutes = date.getHours() * 60 + date.getMinutes();
    const existing = firstPunchByDay.get(dayKey);

    firstPunchByDay.set(
      dayKey,
      existing === undefined ? minutes : Math.min(existing, minutes)
    );
  }

  const firstPunches = Array.from(firstPunchByDay.values());
  if (firstPunches.length === 0) return null;

  return Math.round(
    firstPunches.reduce((sum, value) => sum + value, 0) / firstPunches.length
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const result = await ensureDailyAutoClockIn(client, {
      employeeId: userId,
      companyId,
      createdBy: userId,
      loginAt: new Date().toISOString(),
      timeZone: (formData.get("timezone") as string | null) ?? "UTC",
      forceNewSession: true
    });

    return { success: !result.error, error: result.error?.message };
  }

  if (intent === "resumeFromBreak") {
    const resumeAt = new Date().toISOString();
    const endedBreak = await endOpenBreakOnLogin(client, {
      employeeId: userId,
      companyId,
      endedBy: userId,
      endTime: resumeAt
    });

    if (endedBreak.error) {
      return { success: false, error: endedBreak.error.message };
    }

    const resumed = await ensureDailyAutoClockIn(client, {
      employeeId: userId,
      companyId,
      createdBy: userId,
      loginAt: resumeAt,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      forceNewSession: !endedBreak.data?.timeCardEntryId
    });

    return { success: !resumed.error, error: resumed.error?.message };
  }

  return { success: false, error: "Unknown intent" };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const weekOffset = parseInt(url.searchParams.get("week") ?? "0", 10);
  const { from, to } = getWeekBounds(weekOffset);

  const [entries, breaks, openEntry, openBreak, summary, companySettings] =
    await Promise.all([
      client
        .from("timeCardEntry")
        .select("*")
        .eq("employeeId", userId)
        .eq("companyId", companyId)
        .gte("clockIn", from)
        .lte("clockIn", to)
        .order("clockIn", { ascending: false }),
      getTimeCardBreaks(client, {
        employeeId: userId,
        companyId,
        from,
        to
      }),
      getOpenClockEntry(client, userId, companyId),
      getOpenTimeCardBreak(client, userId, companyId),
      getWeeklyTimecardSummary(client, {
        companyId,
        employeeId: userId,
        weekStart: from
      }),
      (client as any)
        .from("companySettings")
        .select("showEmployeeOvertime")
        .eq("id", companyId)
        .single()
    ]);

  return {
    entries: entries.data ?? [],
    breaks: breaks.data ?? [],
    openEntry: openEntry.data,
    openBreak: openBreak.data,
    summary: summary[0] ?? null,
    weekOffset,
    from,
    to,
    showEmployeeOvertime: companySettings.data?.showEmployeeOvertime ?? false
  };
}

export default function MESTimecardPage() {
  const {
    entries,
    breaks,
    openEntry,
    openBreak,
    summary,
    weekOffset,
    from,
    to,
    showEmployeeOvertime
  } = useLoaderData<typeof loader>();
  const [, setTick] = useState(0);

  const monday = new Date(from);
  const sunday = new Date(to);
  const isCurrentWeek = weekOffset === 0;
  const localAverageFirstPunchMinutes = getAverageFirstPunchMinutes(entries);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-[calc(100dvh-49px)] overflow-y-auto">
      <div className="flex w-full flex-col space-y-4 px-4 py-4 md:px-6 md:py-6">
        {openBreak && (
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              {openEntry
                ? "Break Status Needs Attention"
                : "You Are Still On Break"}
            </AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{getBreakWarningMessage({ openBreak, openEntry })}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Break started at {formatTime(openBreak.startTime)} on{" "}
                  {formatDay(openBreak.startTime)}.
                </span>
                <Form method="post">
                  <input type="hidden" name="intent" value="resumeFromBreak" />
                  <Button size="sm" type="submit" leftIcon={<LuPlay />}>
                    Resume Paid Work
                  </Button>
                </Form>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden">
          <CardHeader>
            <HStack className="items-center justify-between">
              <CardTitle>My Hours</CardTitle>
              <HStack className="gap-2">
                {openEntry ? (
                  <>
                    <Form method="post" action={path.to.startBreak}>
                      <input type="hidden" name="breakType" value="Break" />
                      <Button
                        variant="secondary"
                        type="submit"
                        leftIcon={<LuPause />}
                      >
                        Break
                      </Button>
                    </Form>
                    <Form method="post" action={path.to.startBreak}>
                      <input type="hidden" name="breakType" value="Lunch" />
                      <Button variant="destructive" type="submit">
                        Lunch
                      </Button>
                    </Form>
                  </>
                ) : openBreak ? (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="resumeFromBreak"
                    />
                    <input
                      type="hidden"
                      name="timezone"
                      value={getLocalTimeZone()}
                    />
                    <Button leftIcon={<LuPlay />} type="submit">
                      Resume Paid Work
                    </Button>
                  </Form>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="clockIn" />
                    <input
                      type="hidden"
                      name="timezone"
                      value={getLocalTimeZone()}
                    />
                    <Button leftIcon={<LuPlay />} type="submit">
                      Clock In
                    </Button>
                  </Form>
                )}
              </HStack>
            </HStack>
            {openBreak ? (
              <Badge variant="yellow" className="w-fit">
                On break since {formatTime(openBreak.startTime)}
              </Badge>
            ) : openEntry ? (
              <Badge variant="green" className="w-fit">
                Working since {formatTime(openEntry.clockIn)}
              </Badge>
            ) : null}
          </CardHeader>

          <CardContent>
            <HStack className="mb-4 items-center justify-between">
              <Button variant="outline" asChild leftIcon={<LuChevronLeft />}>
                <Link to={`${path.to.timeCardPage}?week=${weekOffset - 1}`}>
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
                  <Link to={`${path.to.timeCardPage}?week=${weekOffset + 1}`}>
                    Next
                  </Link>
                )}
              </Button>
            </HStack>

            <div className="mb-4 overflow-x-auto">
              <div className="grid min-w-[700px] grid-cols-5 gap-2">
                <Card className="border-border/60">
                  <CardHeader className="px-3 py-2">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Worked
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 pt-0 text-sm font-semibold">
                    {formatMinutes(summary?.totalWorkedMinutes ?? 0)}
                  </CardContent>
                </Card>

                {showEmployeeOvertime ? (
                  <Card className="border-border/60">
                    <CardHeader className="px-3 py-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Overtime
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3 pt-0 text-sm font-semibold">
                      {formatMinutes(summary?.overtimeMinutes ?? 0)}
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-border/60">
                    <CardHeader className="px-3 py-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Status
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3 pt-0 text-sm font-semibold">
                      {openBreak
                        ? "On Break"
                        : openEntry
                          ? "Working"
                          : "Off Shift"}
                    </CardContent>
                  </Card>
                )}

                <Card className="border-border/60">
                  <CardHeader className="px-3 py-2">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Break Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 pt-0 text-sm font-semibold">
                    {formatMinutes(summary?.breakMinutes ?? 0)}
                  </CardContent>
                </Card>

                <Card className="border-border/60">
                  <CardHeader className="px-3 py-2">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Avg Break
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 pt-0 text-sm font-semibold">
                    {formatMinutes(summary?.averageBreakMinutes ?? 0)}
                  </CardContent>
                </Card>

                <Card className="border-border/60">
                  <CardHeader className="px-3 py-2">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Avg Start Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 pt-0 text-sm font-semibold">
                    {formatAverageClock(localAverageFirstPunchMinutes)}
                  </CardContent>
                </Card>
              </div>
            </div>

            <TableBase className="table-fixed w-full">
              <Thead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Clock In</Th>
                  <Th>Clock Out</Th>
                  <Th className="text-center">Duration</Th>
                </Tr>
              </Thead>
              <Tbody>
                {entries.length === 0 ? (
                  <Tr>
                    <Td
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No time entries for this week
                    </Td>
                  </Tr>
                ) : (
                  entries.map((entry) => (
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
                    </Tr>
                  ))
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
                </Tr>
              </Thead>
              <Tbody>
                {breaks.length === 0 ? (
                  <Tr>
                    <Td
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No breaks recorded this week
                    </Td>
                  </Tr>
                ) : (
                  breaks.map((timecardBreak) => (
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
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableBase>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
