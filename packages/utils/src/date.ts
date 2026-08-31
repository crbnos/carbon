import {
  getLocalTimeZone,
  parseAbsolute,
  parseDate,
  parseTime,
  toZoned
} from "@internationalized/date";

const DEFAULT_LOCALE = "en-US";

const DIVISIONS: { amount: number; name: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, name: "seconds" },
  { amount: 60, name: "minutes" },
  { amount: 24, name: "hours" },
  { amount: 7, name: "days" },
  { amount: 4.34524, name: "weeks" },
  { amount: 12, name: "months" },
  { amount: Number.POSITIVE_INFINITY, name: "years" }
];

const defaultFormatOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeZone: getLocalTimeZone()
};

// `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` constructors are
// expensive (locale data lookup + ICU init). These caches reuse the
// formatter for the default-options call sites — `formatDate(d)` in tables
// and `formatTimeAgo(t)` in feeds run thousands of times per render.
// Custom-options calls fall through to a fresh formatter to avoid hashing
// the options bag.
const defaultDateFormatters = new Map<string, Intl.DateTimeFormat>();
function getDefaultDateFormatter(locale: string): Intl.DateTimeFormat {
  let f = defaultDateFormatters.get(locale);
  if (f === undefined) {
    f = new Intl.DateTimeFormat(locale, defaultFormatOptions);
    defaultDateFormatters.set(locale, f);
  }
  return f;
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
function getRelativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let f = relativeFormatters.get(locale);
  if (f === undefined) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormatters.set(locale, f);
  }
  return f;
}

/** Milliseconds per hour/day — for arithmetic on absolute epoch instants. */
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export function convertDateStringToIsoString(dateString: string) {
  return new Date(dateString).toISOString();
}

export function formatDate(
  dateString?: string | null,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
) {
  if (!dateString) return "";
  const _locale = locale || DEFAULT_LOCALE;
  const formatter = options
    ? new Intl.DateTimeFormat(_locale, options)
    : getDefaultDateFormatter(_locale);
  try {
    const _dateString = toZoned(
      parseDate(dateString),
      getLocalTimeZone()
    ).toAbsoluteString();

    // @ts-expect-error
    const date = parseAbsolute(_dateString);

    return formatter.format(date.toDate());
  } catch {
    try {
      const date = new Date(dateString);
      return formatter.format(date);
    } catch {
      return dateString;
    }
  }
}

export function formatDateTime(isoString: string, locale?: string) {
  return formatDate(
    isoString,
    { dateStyle: "short", timeStyle: "short" },
    locale
  );
}

export function formatRelativeTime(isoString: string, locale?: string) {
  if (new Date(isoString).getTime() > new Date().getTime()) {
    return formatTimeFromNow(isoString, locale);
  } else {
    return formatTimeAgo(isoString, locale);
  }
}

export function formatTimeAgo(isoString: string, locale?: string) {
  const relativeFormatter = getRelativeFormatter(locale || DEFAULT_LOCALE);
  let duration = (new Date(isoString).getTime() - Date.now()) / 1000;

  const len = DIVISIONS.length;
  for (let i = 0; i < len; i++) {
    const division = DIVISIONS[i]!;
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(duration), division.name);
    }
    duration /= division.amount;
  }
  return "";
}

export function formatTimeFromNow(isoString: string, locale?: string) {
  const relativeFormatter = getRelativeFormatter(locale || DEFAULT_LOCALE);
  let duration = (Date.now() - new Date(isoString).getTime()) / 1000;

  const len = DIVISIONS.length;
  for (let i = 0; i < len; i++) {
    const division = DIVISIONS[i]!;
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(-1 * duration), division.name);
    }
    duration /= division.amount;
  }
  return "";
}

export function getDateNYearsAgo(n: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - n);
  return date;
}

export function formatDateTimeInZone(
  isoString: string,
  timeZone: string,
  locale?: string,
  options?: Intl.DateTimeFormatOptions
) {
  if (!isoString) return "";
  try {
    const instant = parseAbsolute(isoString, timeZone);
    return new Intl.DateTimeFormat(locale || DEFAULT_LOCALE, {
      dateStyle: "medium",
      timeStyle: "medium",
      ...options,
      timeZone
    }).format(instant.toDate());
  } catch {
    return isoString;
  }
}

// DST-correct because the offset is resolved at the instant, not "today"
export function getTimeZoneOffsetLabel(isoString: string, timeZone: string) {
  try {
    const instant = parseAbsolute(isoString, timeZone);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset"
    }).formatToParts(instant.toDate());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

// Relative distance between two `YYYY-MM-DD` calendar days, in the most
// humane unit: exact days near the present ("in 8 days", with "today"/
// "tomorrow"/"yesterday"), months beyond ~a month, years beyond ~a year —
// never "589 days ago". The caller supplies `todayString` on whichever
// calendar the date belongs to (company/location), so the flip happens at
// business midnight.
export function formatRelativeCalendarDays(
  dateString: string,
  todayString: string,
  locale?: string
) {
  try {
    const days = Math.round(
      (parseDate(dateString).toDate("UTC").getTime() -
        parseDate(todayString).toDate("UTC").getTime()) /
        86400000
    );
    const formatter = getRelativeFormatter(locale || DEFAULT_LOCALE);
    if (Math.abs(days) < 30) return formatter.format(days, "days");
    if (Math.abs(days) < 365)
      return formatter.format(Math.round(days / 30.44), "months");
    return formatter.format(Math.round(days / 365.25), "years");
  } catch {
    return dateString;
  }
}

// Format a bare wall-clock time (`"HH:MM"` / `"HH:MM:SS"`, e.g. a shift start)
// as a localized short time ("8:00 AM"). These carry no date or timezone, so
// there is nothing to convert — the value is anchored to a fixed UTC instant
// purely so `Intl` can format it, and formatted back in UTC to avoid any shift.
export function formatTimeOfDay(value?: string | null, locale?: string) {
  if (!value) return "";
  try {
    const t = parseTime(value);
    const anchor = new Date(Date.UTC(2000, 0, 1, t.hour, t.minute, t.second));
    return new Intl.DateTimeFormat(locale || DEFAULT_LOCALE, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC"
    }).format(anchor);
  } catch {
    return value;
  }
}

const PRECISE_DIVISIONS: { seconds: number; unit: string }[] = [
  { seconds: 31536000, unit: "year" },
  { seconds: 2592000, unit: "month" },
  { seconds: 86400, unit: "day" },
  { seconds: 3600, unit: "hour" },
  { seconds: 60, unit: "minute" },
  { seconds: 1, unit: "second" }
];

export function formatPreciseDuration(
  isoString: string,
  locale?: string,
  nowMs?: number
): { text: string; direction: "past" | "future" } {
  const _locale = locale || DEFAULT_LOCALE;
  const diffMs = new Date(isoString).getTime() - (nowMs ?? Date.now());
  const direction = diffMs > 0 ? "future" : "past";
  let remaining = Math.floor(Math.abs(diffMs) / 1000);

  const segments: string[] = [];
  for (const { seconds, unit } of PRECISE_DIVISIONS) {
    if (segments.length >= 3) break;
    const count = Math.floor(remaining / seconds);
    remaining -= count * seconds;
    // Seconds only matter when the moment is under a minute away — beyond
    // that they're noise ("21 minutes, 2 seconds ago").
    if (unit === "second" ? segments.length === 0 : count > 0) {
      segments.push(
        new Intl.NumberFormat(_locale, {
          style: "unit",
          unit,
          unitDisplay: "long"
        }).format(count)
      );
    }
  }

  const text = new Intl.ListFormat(_locale, {
    style: "long",
    type: "unit"
  }).format(segments);
  return { text, direction };
}
