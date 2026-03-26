import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize } from "~/utils/supabase";

function timeCardBreakTable(client: SupabaseClient<Database>) {
  return (client as any).from("timeCardBreak");
}

function timeCardBreaksView(client: SupabaseClient<Database>) {
  return (client as any).from("timeCardBreaks");
}

function formatDateKey(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(date));
}

function getMinutesSinceMidnight(date: string, timeZone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(date));

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0
  );

  return hour * 60 + minute;
}

function getWeekEnd(weekStart: string) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function formatDurationMinutes(startTime: string, endTime: string | null) {
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  return Math.max(Math.round((end - new Date(startTime).getTime()) / 60000), 0);
}

export async function getOpenClockEntry(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client
    .from("timeCardEntry")
    .select("*")
    .eq("employeeId", employeeId)
    .eq("companyId", companyId)
    .is("clockOut", null)
    .maybeSingle();
}

export async function getOpenTimeCardBreak(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return timeCardBreakTable(client)
    .select("*")
    .eq("employeeId", employeeId)
    .eq("companyId", companyId)
    .is("endTime", null)
    .maybeSingle();
}

export async function clockIn(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    createdBy: string;
    clockIn?: string;
  }
) {
  const existing = await getOpenClockEntry(
    client,
    args.employeeId,
    args.companyId
  );
  if (existing.data) {
    return { data: null, error: { message: "Already clocked in" } };
  }

  const openBreak = await getOpenTimeCardBreak(
    client,
    args.employeeId,
    args.companyId
  );
  if (openBreak.data) {
    return {
      data: null,
      error: {
        message:
          "Cannot clock in while an active break is still open. End the break before resuming paid work."
      }
    };
  }

  return client.from("timeCardEntry").insert(
    sanitize({
      employeeId: args.employeeId,
      companyId: args.companyId,
      createdBy: args.createdBy,
      clockIn: args.clockIn
    })
  );
}

export async function clockOut(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    updatedBy: string;
    clockOut?: string;
    note?: string;
  }
) {
  const open = await getOpenClockEntry(client, args.employeeId, args.companyId);
  if (!open.data) {
    return { data: null, error: { message: "Not currently clocked in" } };
  }

  return client
    .from("timeCardEntry")
    .update(
      sanitize({
        clockOut: args.clockOut ?? new Date().toISOString(),
        note: args.note,
        updatedBy: args.updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", open.data.id);
}

export async function startBreak(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    breakType: "Break" | "Lunch";
    startedBy: string;
    startTime?: string;
    note?: string;
  }
) {
  const openEntry = await getOpenClockEntry(
    client,
    args.employeeId,
    args.companyId
  );
  if (!openEntry.data) {
    return { data: null, error: { message: "Not currently clocked in" } };
  }

  const existingBreak = await getOpenTimeCardBreak(
    client,
    args.employeeId,
    args.companyId
  );
  if (existingBreak.data) {
    return { data: null, error: { message: "Already on break" } };
  }

  const startTime = args.startTime ?? new Date().toISOString();
  const closeEntry = await client
    .from("timeCardEntry")
    .update({
      clockOut: startTime,
      note: args.note,
      updatedBy: args.startedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", openEntry.data.id)
    .select("*")
    .single();

  if (closeEntry.error) return closeEntry;

  return timeCardBreakTable(client)
    .insert({
      employeeId: args.employeeId,
      companyId: args.companyId,
      timeCardEntryId: openEntry.data.id,
      breakType: args.breakType,
      startTime,
      note: args.note,
      startedBy: args.startedBy
    })
    .select("*")
    .single();
}

export async function endOpenBreakOnLogin(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    endedBy: string;
    endTime?: string;
  }
) {
  const openBreak = await getOpenTimeCardBreak(
    client,
    args.employeeId,
    args.companyId
  );

  if (!openBreak.data) {
    return { data: null, error: null };
  }

  const endTime = args.endTime ?? new Date().toISOString();
  const result = await timeCardBreakTable(client)
    .update({
      endTime,
      endedBy: args.endedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", openBreak.data.id);

  return { ...result, data: openBreak.data };
}

export async function ensureDailyAutoClockIn(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    createdBy: string;
    loginAt: string;
    timeZone: string;
    forceNewSession?: boolean;
  }
) {
  const openEntry = await getOpenClockEntry(
    client,
    args.employeeId,
    args.companyId
  );
  if (openEntry.data) {
    return { data: openEntry.data, error: null, created: false };
  }

  if (!args.forceNewSession) {
    const recentEntries = await client
      .from("timeCardEntry")
      .select("id, clockIn")
      .eq("employeeId", args.employeeId)
      .eq("companyId", args.companyId)
      .gte(
        "clockIn",
        new Date(Date.parse(args.loginAt) - 36 * 3600000).toISOString()
      )
      .order("clockIn", { ascending: false })
      .limit(20);

    if (recentEntries.error) {
      return { data: null, error: recentEntries.error, created: false };
    }

    const loginDay = formatDateKey(args.loginAt, args.timeZone);
    const alreadyStartedToday = (recentEntries.data ?? []).some((entry) => {
      return formatDateKey(entry.clockIn, args.timeZone) === loginDay;
    });

    if (alreadyStartedToday) {
      return { data: null, error: null, created: false };
    }
  }

  const created = await clockIn(client, {
    employeeId: args.employeeId,
    companyId: args.companyId,
    createdBy: args.createdBy,
    clockIn: args.loginAt
  });

  return { data: created.data, error: created.error, created: !created.error };
}

export async function getTimeCardBreaks(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    from?: string;
    to?: string;
  }
) {
  let query = timeCardBreakTable(client)
    .select("*")
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId)
    .order("startTime", { ascending: false });

  if (args.from) query = query.gte("startTime", args.from);
  if (args.to) query = query.lte("startTime", args.to);

  return query;
}

export type WeeklyTimecardSummary = {
  employeeId: string;
  companyId: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  totalWorkedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  breakMinutes: number;
  breakCount: number;
  averageBreakMinutes: number;
  averageFirstPunchMinutes: number | null;
  averageBreakStartMinutes: number | null;
  longestBreakMinutes: number;
  missedPunchCount: number;
  openEntryCount: number;
  openBreakCount: number;
};

export async function getWeeklyTimecardSummary(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    employeeId?: string;
    weekStart: string;
    timeZone?: string;
  }
): Promise<WeeklyTimecardSummary[]> {
  const weekEnd = getWeekEnd(args.weekStart);
  const timeZone = args.timeZone ?? "UTC";

  let entriesQuery = (client as any)
    .from("timeCardEntries")
    .select(
      "employeeId, companyId, firstName, lastName, avatarUrl, clockIn, clockOut"
    )
    .eq("companyId", args.companyId)
    .gte("clockIn", args.weekStart)
    .lte("clockIn", weekEnd);

  let breaksQuery = timeCardBreaksView(client)
    .select(
      "employeeId, companyId, firstName, lastName, avatarUrl, breakType, startTime, endTime"
    )
    .eq("companyId", args.companyId)
    .gte("startTime", args.weekStart)
    .lte("startTime", weekEnd);

  if (args.employeeId) {
    entriesQuery = entriesQuery.eq("employeeId", args.employeeId);
    breaksQuery = breaksQuery.eq("employeeId", args.employeeId);
  }

  const [entries, breaks] = await Promise.all([entriesQuery, breaksQuery]);
  if (entries.error || breaks.error) return [];

  const byEmployee = new Map<string, WeeklyTimecardSummary>();
  const firstPunchesByDay = new Map<string, number[]>();
  const breakStartsByEmployee = new Map<string, number[]>();

  for (const entry of entries.data ?? []) {
    const existing = byEmployee.get(entry.employeeId) ?? {
      employeeId: entry.employeeId,
      companyId: entry.companyId,
      firstName: entry.firstName,
      lastName: entry.lastName,
      avatarUrl: entry.avatarUrl,
      totalWorkedMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      breakMinutes: 0,
      breakCount: 0,
      averageBreakMinutes: 0,
      averageFirstPunchMinutes: null,
      averageBreakStartMinutes: null,
      longestBreakMinutes: 0,
      missedPunchCount: 0,
      openEntryCount: 0,
      openBreakCount: 0
    };

    existing.totalWorkedMinutes += formatDurationMinutes(
      entry.clockIn,
      entry.clockOut
    );

    if (!entry.clockOut) {
      existing.missedPunchCount += 1;
      existing.openEntryCount += 1;
    }

    const dayKey = `${entry.employeeId}:${formatDateKey(entry.clockIn, timeZone)}`;
    const minutes = getMinutesSinceMidnight(entry.clockIn, timeZone);
    firstPunchesByDay.set(dayKey, [
      ...(firstPunchesByDay.get(dayKey) ?? []),
      minutes
    ]);

    byEmployee.set(entry.employeeId, existing);
  }

  for (const row of byEmployee.values()) {
    row.overtimeMinutes = Math.max(row.totalWorkedMinutes - 40 * 60, 0);
    row.regularMinutes = Math.max(
      row.totalWorkedMinutes - row.overtimeMinutes,
      0
    );
  }

  for (const timecardBreak of breaks.data ?? []) {
    const existing = byEmployee.get(timecardBreak.employeeId) ?? {
      employeeId: timecardBreak.employeeId,
      companyId: timecardBreak.companyId,
      firstName: timecardBreak.firstName,
      lastName: timecardBreak.lastName,
      avatarUrl: timecardBreak.avatarUrl,
      totalWorkedMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      breakMinutes: 0,
      breakCount: 0,
      averageBreakMinutes: 0,
      averageFirstPunchMinutes: null,
      averageBreakStartMinutes: null,
      longestBreakMinutes: 0,
      missedPunchCount: 0,
      openEntryCount: 0,
      openBreakCount: 0
    };

    const duration = formatDurationMinutes(
      timecardBreak.startTime,
      timecardBreak.endTime
    );

    existing.breakMinutes += duration;
    existing.breakCount += 1;
    existing.longestBreakMinutes = Math.max(
      existing.longestBreakMinutes,
      duration
    );

    if (!timecardBreak.endTime) {
      existing.missedPunchCount += 1;
      existing.openBreakCount += 1;
    }

    breakStartsByEmployee.set(timecardBreak.employeeId, [
      ...(breakStartsByEmployee.get(timecardBreak.employeeId) ?? []),
      getMinutesSinceMidnight(timecardBreak.startTime, timeZone)
    ]);

    byEmployee.set(timecardBreak.employeeId, existing);
  }

  for (const [employeeId, row] of byEmployee.entries()) {
    const breakStarts = breakStartsByEmployee.get(employeeId) ?? [];
    row.averageBreakMinutes =
      row.breakCount > 0 ? Math.round(row.breakMinutes / row.breakCount) : 0;
    row.averageBreakStartMinutes =
      breakStarts.length > 0
        ? Math.round(
            breakStarts.reduce((sum, value) => sum + value, 0) /
              breakStarts.length
          )
        : null;

    const firstPunchValues = Array.from(firstPunchesByDay.entries())
      .filter(([key]) => key.startsWith(`${employeeId}:`))
      .map(([, values]) => Math.min(...values));

    row.averageFirstPunchMinutes =
      firstPunchValues.length > 0
        ? Math.round(
            firstPunchValues.reduce((sum, value) => sum + value, 0) /
              firstPunchValues.length
          )
        : null;
  }

  return Array.from(byEmployee.values()).sort((a, b) => {
    const aName = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
    const bName = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim();
    return aName.localeCompare(bName);
  });
}

export async function updateTimeCardEntry(
  client: SupabaseClient<Database>,
  args: {
    entryId: string;
    clockIn?: string;
    clockOut?: string | null;
    note?: string | null;
    updatedBy: string;
  }
) {
  return client
    .from("timeCardEntry")
    .update(
      sanitize({
        clockIn: args.clockIn,
        clockOut: args.clockOut,
        note: args.note,
        updatedBy: args.updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", args.entryId);
}

export async function updateTimeCardBreak(
  client: SupabaseClient<Database>,
  args: {
    breakId: string;
    breakType?: "Break" | "Lunch";
    startTime?: string;
    endTime?: string | null;
    note?: string | null;
    endedBy?: string | null;
  }
) {
  return timeCardBreakTable(client)
    .update(
      sanitize({
        breakType: args.breakType,
        startTime: args.startTime,
        endTime: args.endTime,
        note: args.note,
        endedBy: args.endedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", args.breakId);
}

export async function deleteTimeCardBreak(
  client: SupabaseClient<Database>,
  breakId: string
) {
  return timeCardBreakTable(client).delete().eq("id", breakId);
}
