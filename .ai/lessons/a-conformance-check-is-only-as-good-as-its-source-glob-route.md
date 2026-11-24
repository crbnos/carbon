---
paths: ["packages/checks/src/sources/server-files.ts", "packages/checks/src/conformance/*.ts"]
triggers: ["maskClientCode", "SERVER_CHECKS", "ConformanceCheck"]
promoted: null
---
# A conformance check is only as good as its source glob — route modules are server AND client in one file

**Context:** The timezone audit (branch `sid/timezone-tz-audit`, PR #1339) added the `no-local-timezone` conformance check to ban process-timezone day derivation in server code. Self-review then found 26 surviving violations in route files, plus more in files the check DID scan using idioms it didn't match.

**Problem:** Two independent under-coverages compounded. (1) The check's source globs (`sources/server-files.ts`) listed services, jobs, and edge functions but not `apps/*/app/routes` — and collected only `.ts`, never `.tsx` — so route loaders/actions (server code!) were never scanned. (2) The banned-pattern list encoded only the idioms already found (`getLocalTimeZone(`, UTC-slicing), not the bug class — `new Date().getDay()` shift rosters and `setHours(0,0,0,0)` week boundaries sailed through in files that WERE scanned. Naively adding the route glob would over-flag: a route module's default export, `clientLoader`/`clientAction`, and hooks run in the browser where the local timezone is correct. Masking IN loader/action bodies also failed — module-level helpers a loader calls (e.g. `getExpiredItemIds`) are server code outside those bodies.

**Rule:** When authoring a conformance check, verify the checker actually loads every file class the rule applies to (run it, count the files, grep one known-bad file into the scan). Ban the bug class, not just the instances you found — then run the widened pattern over the full source set and fix or baseline everything it surfaces before landing. For React Router route modules, path-level globs are the wrong granularity: mask OUT the client regions by declaration shape (`maskClientCode` blanks default export / `clientLoader` / `clientAction` / PascalCase and `use*` declarations) so server helpers stay covered; masking IN named exports under-covers. And when masking by line shape, the region CLOSER is as bug-prone as the opener: a `)` closer that also matches a multi-line signature's `) {` line ends the region before the body and un-masks client code (only statement-terminating `)`/`);` lines close a region), while an expression-bodied one-liner (`const X = () => null;`) must never OPEN a region at all — pin both shapes as regression tests.

**Applies to:** `packages/checks/src/sources/server-files.ts` + `conformance/no-local-timezone.ts`; any new `SERVER_CHECKS` rule; any lint/conformance gate keyed on file paths over `apps/*/app/routes`.
