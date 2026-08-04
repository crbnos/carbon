---
paths:
  - "apps/erp/app/**"
  - "apps/mes/app/**"
  - "packages/react/src/**"
  - "packages/form/src/**"
  - "packages/jobs/src/**"
  - "packages/utils/src/**"
---

# Date & Time Handling

**Do not use JavaScript `Date` for parsing, formatting, or arithmetic.** Use
`@internationalized/date` and the repo's `@carbon/utils` date helpers, following
the patterns already used across the codebase.

## Why

A JS `Date` silently applies the runtime timezone. A date-only value stored as
midnight UTC (e.g. `maintenanceSchedule.nextDueAt`, `location`-scoped due dates)
then renders a **day early** for any viewer behind UTC — the exact bug where a
table showed `8/11` while the form showed `8/12`. `Date` arithmetic also
overflows month-ends (`setMonth` on Jan 31 → Mar 3), which schedule generation
must not do.

## Banned → use instead

| Don't | Do |
|-------|----|
| `new Date(str).toLocaleDateString(locale)` | `formatDate(str, options?, locale)` (`@carbon/utils`) |
| `new Date(str)` to parse a timestamp | `parseAbsolute(str, timeZone)` → `ZonedDateTime` |
| `new Date(str)` to parse a `YYYY-MM-DD` | `parseDate(str)` → `CalendarDate` |
| `d.setDate/​setMonth/​setFullYear(...)` | `zdt.add({ days })` / `.add({ months })` / `.add({ years })` (clamps month-ends) |
| `d.setHours(0,0,0,0)` for start-of-day | `fromDate(d, tz).set({ hour: 0, minute: 0, second: 0, millisecond: 0 })` |
| `d1 <= d2` on `Date`s | `a.compare(b) <= 0` on `ZonedDateTime`/`CalendarDate` |
| `d.getDay()` | `getDayOfWeek(date, "en-US")` (0 = Sun … 6 = Sat) |
| `d.toISOString()` for a column write | `zdt.toAbsoluteString()` |
| `"now"` as `new Date()` in server code | `now(getLocalTimeZone())` → `ZonedDateTime` |

## Repo patterns to copy

- **Display a date in a table/cell:** `formatDate(row.original.field, undefined, locale)`
  from `@carbon/utils` (parses via `parseDate` → no timezone shift). Every ERP
  table date column uses this (`JournalEntriesTable`, `PeriodsTable`, …).
- **A `timestamptz` column that represents a *date*** (e.g. `nextDueAt`, stored as
  midnight UTC): take the date part first — `formatDate(value.slice(0, 10), …)`
  for display, and `value.slice(0, 10)` to seed a `DatePicker`
  (`scheduled-maintenance.$scheduleId.tsx` does exactly this). The `DatePicker`
  (`packages/form/src/components/DatePicker.tsx`) already parses/formats with
  `@internationalized/date`.
- **Day boundaries in a timezone:** `fromDate(jsDate, timeZone).set({ hour: 0, … })`
  (`apps/mes/app/utils/display.ts` `startOfDay`/`endOfDay`).
- **Recurring-date arithmetic:** carry a `ZonedDateTime` and `.add({ … })`
  (`packages/jobs/.../scheduled/dispatch.ts` `advanceByFrequency`).

## Narrow exception

A raw `new Date()`/epoch-ms is only acceptable for comparing **absolute instants**
that are timezone-agnostic (e.g. `Date.parse(isoTimestamp)` to sort events by the
moment they occurred). It is never acceptable for anything a user reads as a
calendar date. When in doubt, reach for `@internationalized/date`.
