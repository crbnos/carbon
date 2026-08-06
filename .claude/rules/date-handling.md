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
| `d.toISOString()` for a column write | `zdt.toAbsoluteString()`, or `datetime.timestamp()` for "now" |
| `"now"` / "today" in SERVER code | `datetime.*` (`@carbon/utils`) — see below; `getLocalTimeZone()` is BANNED server-side |

## Server code: the `datetime` API (mandatory)

`getLocalTimeZone()` on a server is the SERVER's zone, not the user's, and
`new Date().toISOString().split("T")[0]` is the UTC day — both are banned in
server paths (`*.service.ts`, `*.server.ts`, `packages/jobs`,
`supabase/functions`, and **route `loader`/`action` bodies** under
`apps/{erp,mes}/app/routes`) and enforced by the `no-local-timezone` conformance
check in `@carbon/checks`. Route modules are server AND client in one file, so
`sources/server-files.ts` masks out the default export, `clientLoader`/
`clientAction`, and PascalCase/`use*` declarations before scanning — module-level
helpers a loader calls ARE scanned. Instead:

- `datetime.timestamp()` — UTC instant string for `createdAt`/`updatedAt`/instant columns (the only tz-free method).
- `datetime.today(tz)` / `datetime.now(tz)` — calendar day / zoned now in an explicit IANA timezone.
- `datetime.businessDay(instantStr, tz)` — which day a stored instant falls on in tz.
- Resolve `tz` with `getCompanyTimeZone(client, companyId)` (ledger-scoped: posting dates, accounting periods, sequences, aging) or `getLocationTimeZone(client, locationId, companyId)` (operational: scheduling, shifts, MES, expiry) from `@carbon/database`. Deno edge functions use the mirror in `functions/lib/datetime.ts` (`getCompanyTimeZoneDb`/`getLocationTimeZoneDb` for Kysely).
- SQL functions use `company_today(p_company_id)` (migration `20260805023439`) or `location_today(p_location_id, p_company_id)` (migration `20260805201623`) instead of `CURRENT_DATE` for business dates. Read-only "is it overdue?" views still compare against `CURRENT_DATE` — they render a status rather than storing one.

Client components keep `today(getLocalTimeZone())` etc. for **display** — in the
browser the local timezone IS the user's and is correct for pickers and
formatting. But a form default that will be **persisted as a business date**
(`postingDate`, `orderDate`, `dateIssued`, `openDate`, …) must use
`useCompanyToday()` from `~/hooks`: the stored value belongs to the company's
calendar, not to whichever zone the person filling the form happens to be in.

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
- **Week windows (payroll/timecards):** `datetime.weekBounds(tz, offset?)` —
  Monday→Sunday UTC-instant bounds on the business calendar (used by
  `getWeeklyHoursForEmployees` and both timecard routes). Don't hand-roll
  `startOfWeek(...).toDate(tz)`; the helper is the tested copy.
- **Recurring-date arithmetic:** carry a `ZonedDateTime` and `.add({ … })`
  (`packages/jobs/.../scheduled/dispatch.ts` `advanceByFrequency`).

## DST: wall-clock times are not instants

Deriving a *day* in a tz is always safe; constructing an *instant from a local
wall time* (a shift start, a job's scheduled start, a day/week boundary) is
where DST bites. The stress suite pinning all of this lives in
`packages/utils/src/datetime.test.ts` ("DST and exotic-zone stress").

- **Spring-forward gap** (02:30 doesn't exist): `toZoned` with the default
  `disambiguation: "compatible"` shifts forward into the post-gap hour — a
  02:30 job start fires at 03:30 local, never crashes. **Fall-back overlap**
  (01:30 happens twice): `"compatible"` picks the first occurrence — the job
  fires once, not twice. Pass an explicit disambiguation only when the domain
  demands the other choice.
- **Some zones transition AT midnight** (America/Santiago): on spring-forward
  day 00:00 doesn't exist and `CalendarDate.toDate(tz)` resolves to the day's
  true first instant (01:00). Never construct "midnight" by string-building
  `T00:00:00` + an offset.
- **Transition weeks are 167h/169h** (Lord Howe: ±30min, and offsets like
  Kathmandu's +05:45 exist) — never assume 24h days or 168h weeks; duration
  arithmetic on instants and calendar arithmetic on `CalendarDate` are both
  fine, mixing them is not.
- **Cron schedules cannot express a local wall time.** "02:30 local" is a
  different UTC instant before vs after a transition, so Inngest crons stay on
  UTC schedules and compute per-company/location *days* inside the run. If a
  job must ever fire at an exact local wall time, compute the next-run instant
  via `toZoned(...)` per zone — don't fake it with a fixed UTC cron.

## Narrow exception

A raw `new Date()`/epoch-ms is only acceptable for comparing **absolute instants**
that are timezone-agnostic (e.g. `Date.parse(isoTimestamp)` to sort events by the
moment they occurred). It is never acceptable for anything a user reads as a
calendar date. When in doubt, reach for `@internationalized/date`.
