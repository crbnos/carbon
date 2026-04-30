import {
  getLocalTimeZone,
  parseAbsolute,
  parseDate,
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
  try {
    const _dateString = toZoned(
      parseDate(dateString),
      getLocalTimeZone()
    ).toAbsoluteString();

    // @ts-expect-error
    const date = parseAbsolute(_dateString);

    return new Intl.DateTimeFormat(
      _locale,
      options || defaultFormatOptions
    ).format(date.toDate());
  } catch {
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat(
        _locale,
        options || defaultFormatOptions
      ).format(date);
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
  const relativeFormatter = new Intl.RelativeTimeFormat(
    locale || DEFAULT_LOCALE,
    { numeric: "auto" }
  );
  let duration = (new Date(isoString).getTime() - new Date().getTime()) / 1000;

  for (let i = 0; i <= DIVISIONS.length; i++) {
    const division = DIVISIONS[i];
    if (!division) return "";
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(duration), division.name);
    }
    duration /= division.amount;
  }
  return "";
}

export function formatTimeFromNow(isoString: string, locale?: string) {
  const relativeFormatter = new Intl.RelativeTimeFormat(
    locale || DEFAULT_LOCALE,
    { numeric: "auto" }
  );
  let duration = (new Date().getTime() - new Date(isoString).getTime()) / 1000;

  for (let i = 0; i <= DIVISIONS.length; i++) {
    const division = DIVISIONS[i];
    if (!division) return "";
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(-1 * duration), division.name);
    }
    duration /= division!.amount;
  }
}

export function getDateNYearsAgo(n: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - n);
  return date;
}
