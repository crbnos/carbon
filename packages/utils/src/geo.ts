export type TimezoneOption = { label: string; value: string };
export type TimezoneGroup = { label: string; options: TimezoneOption[] };

/** True when `tz` is an IANA timezone the runtime (and Postgres) can resolve. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset"
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT" (UTC itself) and "GMT-06:00" → "±HH:MM" (relative-to-UTC implied)
    return name === "GMT" ? "+00:00" : name.replace("GMT", "");
  } catch {
    return "";
  }
}

const timeZoneNameOf = (
  zone: string,
  style: "short" | "long",
  month: number
): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: style
  }).formatToParts(new Date(Date.UTC(new Date().getUTCFullYear(), month, 15)));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
};

const displayNameCache = new Map<string, string>();

/**
 * A zone's colloquial name ("Eastern Time"), from CLDR. Empty when the runtime
 * only offers a bare "GMT+05:30", which the offset already covers.
 */
export function getTimezoneDisplayName(zone: string): string {
  const cached = displayNameCache.get(zone);
  if (cached !== undefined) return cached;

  let name = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longGeneric"
    }).formatToParts(new Date());
    const value = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    if (!/^(GMT|UTC)([+-]|$)/.test(value)) name = value;
  } catch {
    // Unresolvable zone, or an ICU without `longGeneric`.
  }
  displayNameCache.set(zone, name);
  return name;
}

const ABBREVIATION = /^[A-Za-z]{2,6}$/;
const abbreviationCache = new Map<string, string[]>();

/**
 * Colloquial abbreviations for a zone — what people actually type into the
 * picker: CST/CDT, EST, PST, IST, JST, AEST… Sampled in January AND July so
 * both the standard and daylight names appear. US-style zones get them from
 * Intl's `short` name directly; zones where en-US `short` is a "GMT+5:30"
 * offset (India, Japan, Australia…) derive them from the `long` name's
 * initials ("India Standard Time" → IST). Memoized — abbreviations don't
 * change within a session.
 */
export function getTimezoneAbbreviations(zone: string): string[] {
  const cached = abbreviationCache.get(zone);
  if (cached) return cached;

  const abbreviations: string[] = [];
  const add = (abbreviation: string) => {
    if (
      ABBREVIATION.test(abbreviation) &&
      !abbreviations.includes(abbreviation)
    ) {
      abbreviations.push(abbreviation);
    }
  };
  try {
    for (const month of [0, 6]) {
      const short = timeZoneNameOf(zone, "short", month);
      if (ABBREVIATION.test(short)) {
        add(short);
        continue;
      }
      const words = timeZoneNameOf(zone, "long", month).split(/\s+/);
      add(words.map((word) => word[0]).join(""));
      // The generic form too — "Central European Standard Time" gives CEST,
      // but people search CET. Skip when it collapses below 3 letters (CT,
      // IT…) — too short to be a useful search token.
      const generic = words
        .filter((word) => !/^(Standard|Summer|Daylight)$/i.test(word))
        .map((word) => word[0])
        .join("");
      if (generic.length >= 3) add(generic);
    }
  } catch {
    // Unresolvable zone — no abbreviations.
  }
  abbreviationCache.set(zone, abbreviations);
  return abbreviations;
}

let cachedTimezones: TimezoneGroup[] | null = null;
let cachedAt = 0;
// Offset labels show the CURRENT UTC offset, which changes at DST transitions —
// an immortal memo on a long-lived server would keep showing the old offset.
// One hour bounds the staleness while still amortizing the ~420 Intl lookups.
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * IANA timezones from the runtime's own tzdata (`Intl.supportedValuesOf`) —
 * no hardcoded list to drift. Grouped by region, labeled with the current UTC
 * offset. Canonical IANA names, so every value is also valid for Postgres
 * `AT TIME ZONE` (used by `company_today()`). Memoized: the ~420 offset
 * lookups run at most once per hour, not per render.
 */
export function getTimezones(): TimezoneGroup[] {
  if (cachedTimezones && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedTimezones;
  }

  const zones: string[] =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  // Bare "UTC" is the DB default and backfill value but is absent from some
  // runtimes' supported list — the picker must always be able to render it.
  if (!zones.includes("UTC")) zones.unshift("UTC");

  const groups = new Map<string, TimezoneOption[]>();
  for (const zone of zones) {
    const [region = "Other", ...rest] = zone.split("/");
    const city = rest.join("/").replace(/_/g, " ");
    const group = rest.length === 0 ? "Other" : region;
    const offset = offsetLabel(zone);
    // "CST/CDT, -06:00" — abbreviations first so typing "CST" finds the zone
    // instead of matching stray letters in other city names; the offset is
    // relative to UTC by definition, so no prefix. An abbreviation identical
    // to the zone name (UTC, GMT) adds nothing and is dropped.
    const abbreviations = getTimezoneAbbreviations(zone)
      .filter((a) => a !== zone)
      .join("/");
    const detail = [abbreviations, offset].filter(Boolean).join(", ");
    const label = `${city || zone}${detail ? ` (${detail})` : ""}`;
    const options = groups.get(group) ?? [];
    options.push({ label, value: zone });
    groups.set(group, options);
  }

  const regionOrder = [
    "America",
    "Europe",
    "Asia",
    "Africa",
    "Australia",
    "Pacific",
    "Atlantic",
    "Indian",
    "Antarctica",
    "Arctic",
    "Other"
  ];

  cachedTimezones = [...groups.entries()]
    .sort(
      ([a], [b]) =>
        (regionOrder.indexOf(a) + 1 || 99) - (regionOrder.indexOf(b) + 1 || 99)
    )
    .map(([label, options]) => ({
      label,
      options: options.sort((a, b) => a.label.localeCompare(b.label))
    }));
  cachedAt = Date.now();

  return cachedTimezones;
}
