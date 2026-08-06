# Fix all 18 self-review findings on sid/timezone-tz-audit

## Context

Self-review of PR #1339 (timezone audit) found 18 issues: 4 must-fix timezone bugs the branch's own conformance check failed to catch, 4 risks, 5 code-quality items, and 5 docs-freshness gaps. The root cause of the must-fixes is that `no-local-timezone` only bans `getLocalTimeZone()` and UTC-slicing — it misses local date-part getters (`new Date().getDay()`) and local-midnight boundaries (`setHours(0,0,0,0)`), so the same bug class survived in people/timecard code. Fix the sites, then widen the check so they can't return.

A blast-radius scan of the widened patterns over all scanned server files found exactly these sites needing fixes (no baseline additions needed once fixed): `people.service.ts:772,842-845`, `person+/$personId.timecard.tsx:70-79` (loader-called), `mes/timecard.tsx:53-61` (loader-called), `update-purchased-prices/index.ts:219`.

**Design decisions (flagging for approval):**
- **Weekly timecard windows use company TZ** (one payroll calendar per books), not per-employee location — consistent across `getWeeklyHoursForEmployees` and both timecard routes.
- **`company_today`/`location_today` stay SECURITY INVOKER** (#7): making them DEFINER would expose a cross-tenant "what's company X's local date" RPC via PostgREST. Instead document the invariant (every current caller is SECURITY DEFINER or service-role, so the silent-UTC fallback path is unreachable) in the migration.
- **#12 (hook stale across midnight) is acknowledged, not fixed** — forms are short-lived; a comment notes the tradeoff.

## Fixes

### 1. Widen the conformance check (#4) — do this first, it gates the rest

`packages/checks/src/conformance/no-local-timezone.ts` — add two BANNED patterns:
- `/new Date\(\)\s*\.get(?:Day|Date|Month|FullYear|Hours|Minutes)\(/g` — "local date-part of now on a server"
- `/\.setHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/g` — "local midnight boundary; derive the day in an explicit tz"

Extend `no-local-timezone.test.ts` with cases for both (flagged) and for safe idioms (UTC getters, `new Date(y, m, d).getFullYear()` roundtrips are NOT banned — patterns are anchored to `new Date().` / the 0,0,0,0 literal, so `shared.server.ts` `dateToString` and client helpers stay clean).

### 2. people.service.ts (#2, #3)

`apps/erp/app/modules/people/people.service.ts` — both are MCP-exposed with `(client, companyId)` already in scope; resolve tz via the **raw** `getCompanyTimeZone` from `@carbon/database` (services must not import the Redis wrapper — client-bundle leak):
- `getScheduledEmployeesToday:772` — replace `dayNames[new Date().getDay()]` with `getDayOfWeek(today(tz), "en-US")` (0=Sun, matches `dayNames` order).
- `getWeeklyHoursForEmployees:841-845` — replace the `getDay/setDate/setHours(0,0,0,0)` Monday computation with `startOfWeek(today(tz), "en-GB").toDate(tz)` (en-GB = Monday-first), `.gte("clockIn", monday.toISOString())`.

### 3. Timecard week bounds (flagged by widened check)

Same pattern in two loader-called helpers — give `getWeekBounds` a `tz: string` param, resolve company TZ in the loader (routes may use the cached `~/modules/shared/timezone.server` resolver; MES has no such module — use raw `@carbon/database` resolver there):
- `apps/erp/app/routes/x+/person+/$personId.timecard.tsx:70-79` (loader at :148)
- `apps/mes/app/routes/x+/timecard.tsx:53-61` (loader at :125)

Both consume `datetime.weekBounds(tz, offset?)` — the tested Monday→Sunday helper in `@carbon/utils` (Deno mirror in `functions/lib/datetime.ts`) — rather than hand-rolling `startOfWeek(...).toDate(tz)` per site. Do NOT touch `getShiftTimesForDate` / `toLocalDatetimeInput` — verified client-called only (datetime-local input prefill; browser tz is correct there).

### 4. Sequence preview tz (#1, #10)

- `apps/erp/app/modules/settings/settings.service.ts:312-313` (`getCurrentSequence`, also MCP tool): resolve company tz (raw `@carbon/database` resolver) and pass to both `interpolateSequenceDate` calls.
- `apps/erp/app/utils/string.ts` — change signature default to `timezone = "UTC"` to match the Deno copy exactly; update its comment.
- Client previews pass the real tz: `SequenceForm.tsx:42-43` and `ItemSerialSequenceForm.tsx:52-53` pass `useCompanyTimeZone()` (new hook already exists in `~/hooks`).

### 5. Intercompany source-company day (#5)

- `apps/erp/app/modules/accounting/accounting.service.ts:349-355` (`getCompaniesInGroup`): add `timezone` to the select.
- `apps/erp/app/modules/accounting/ui/Intercompany/IntercompanyTransactionForm.tsx`: add a `SourcePostingDateSync` component mirroring the existing `SourceCurrencySync` pattern — when `sourceCompanyId` changes, set the `postingDate` field to `today(sourceCompany.timezone).toString()` via `useControlField`. Initial default (no source picked yet) stays `useCompanyToday()` from the route.
- The action-side fallback at `accounting.service.ts:2986` stays as defense-in-depth.

### 6. Honest null handling for locationId (#6)

- `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx` — replace `shipmentForSurface?.locationId as string` with an explicit branch: `locId ? getLocationTimeZone(serviceRole, locId, companyId) : getCompanyTimeZone(serviceRole, companyId)`.
- `apps/erp/app/routes/api+/kanban.$id.tsx` — same for `kanban.data.locationId!`.

### 7. SECURITY INVOKER invariant comment (#7)

Edit `packages/database/supabase/migrations/20260805201623_company-today-sql-writers.sql` (committed but not yet supabase-tracked; idempotent CREATE OR REPLACE) — comment on both helpers: callers must be SECURITY DEFINER or service-role; under RLS denial these silently return UTC, and we deliberately do NOT make them SECURITY DEFINER to avoid exposing a cross-tenant date/timezone probe via PostgREST RPC.

### 8. Jobs-package local-day fixes (#8, #13, + flagged)

- `packages/jobs/src/inngest/functions/extraction/extract-document.ts:24` — non-ISO text is parsed by `Date.parse` in the PROCESS zone, so local getters are the symmetric round-trip (ISO forms short-circuit earlier); UTC getters would shift the written date west of UTC.
- `packages/jobs/src/inngest/functions/scheduled/audit-archive.ts:52-54` — archive path (storage key) derives from `datetime.today("UTC")` — explicit UTC calendar via the sanctioned API.
- `packages/database/supabase/functions/update-purchased-prices/index.ts:219` — replace the `setFullYear(getFullYear()-1)` construction with instant arithmetic (`new Date(Date.now() - 365 * 86400_000)`) — rolling window, day-precision irrelevant.

### 9. ISO-week dedup (#9)

- `packages/database/supabase/functions/lib/datetime.ts` — delete the inline `weekNumber` body; implement via `isoWeekFromYmd` imported from `./utils.ts` (utils is dependency-free, so this is safe for the node-side `@carbon/database` build — the reverse direction would drag `npm:` imports into the node graph).
- `apps/erp/app/utils/string.ts` — delete the local `getISOWeek` algorithm; derive via `datetime.weekNumber(new CalendarDate(y, m, d))` from `@carbon/utils`.
- Leave: the two datetime.ts mirrors (documented keep-in-sync policy) and `quality.kpi.$key.ts`'s `getISOWeekYear` (needs the ISO week-**year** pair, already UTC-correct).

### 10. Hook consistency (#11, #12)

`apps/erp/app/hooks/useCompanyTimeZone.tsx` — use `datetime.today(tz)` from `@carbon/utils` instead of bare `today()`; add a comment acknowledging the value is computed at render and a form left open across midnight keeps the stale day (accepted).

## Docs (#14–#18)

- `packages/checks/AGENTS.md:34` — update the `noLocalTimezone` line: scans server TS **plus route loaders/actions** in both apps; route files are masked (`maskClientCode`) so components/hooks/clientLoader/clientAction are exempt while module-level server helpers are covered.
- `packages/database/AGENTS.md` — Key Exports: add `getCompanyTimeZone`/`getLocationTimeZone` (`src/timezone.ts`, overloaded Supabase/Kysely), `AnyPostgresClient`/`isKysely` (`src/utils.ts`), and note SQL helpers `company_today()`/`location_today()`.
- `.ai/lessons.md` — new entry (Context → Problem → Rule → Applies to): a conformance check is only as good as its source glob — route modules are server AND client in one file, so path-keyed checks must mask by declaration, and you must verify the checker actually loads the files you think it does.
- Write this plan to `.ai/plans/2026-08-06-timezone-audit-review-fixes.md` (AGENTS.md convention).
- After commit: `gh pr edit 1339` — refresh body (39 route files not 16; conformance-check gap + route sweep; `get_next_sequence`/`location_today` migration; HQ-timezone clobber fix; `useCompanyToday`). Push still gated on explicit approval.

## Verification

1. `pnpm --filter @carbon/checks test` — extended pattern tests green.
2. Conformance scan (`newViolations()` via tsx) — **0 new violations, 0 baseline additions** (proves every widened-pattern site was actually fixed).
3. `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/checks --filter=@carbon/database --filter=@carbon/utils --filter=@carbon/jobs`.
4. `pnpm run lint`.
5. `TZ=America/Chicago pnpm run test` — suite green under non-UTC process tz (the regression gate).
6. `pnpm run build:erp` — catches any client-bundle leak from new service imports.
7. DB spot-check (read-only psql against the India company, currently a day ahead of UTC): `getScheduledEmployeesToday` day-of-week and sequence preview vs `get_next_sequence` output agree with `company_today()`.
8. Commit (no AI attribution), update PR body; push only on explicit approval.
