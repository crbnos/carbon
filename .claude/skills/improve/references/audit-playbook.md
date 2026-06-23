# Audit Playbook (Carbon)

What to look for, per category. Each subagent (or direct audit pass) gets the relevant section plus the **Finding format** and **Carbon-specific checks** at the bottom. Adapt depth to scope — a single package gets a lighter pass than a whole app.

A finding is only a finding with evidence. "Probably has N+1 queries somewhere" is not a finding; `inventory/services/picking.ts:142 issues one query per line inside a loop` is.

**Before flagging anything, cross-check Carbon's settled decisions:** `.claude/scratch/tasks/lessons.md` and `.claude/rules/conventions-*.md` record by-design choices. A pattern documented there is not a finding. Generated files (`packages/database` db-types / swagger schema, Lingui `*.mjs` catalogs, `.react-router/`) are not findings.

---

## 1. Correctness / Bugs

The highest-trust category — real bugs found by reading, not speculation.

- Error handling: swallowed exceptions, empty catch blocks, `catch (e) { console.log(e) }` on critical paths, missing error states in route loaders/actions.
- Async hazards: unawaited promises, race conditions on shared state, missing cleanup (stale closures in React effects, listeners never removed).
- Null/undefined flows: non-null assertions (`!`) on values that can be null, optional chaining hiding a value that must exist, unchecked array indexing.
- Boundary conditions: off-by-one, empty-collection handling, timezone/locale assumptions.
- State machines: status enums with unhandled branches (look for `default:` that silently no-ops); impossible states representable in types.
- Concurrency: check-then-act on shared resources, missing transactions around multi-write operations (see Carbon checks — Kysely transactions), idempotency of retried operations (webhooks, queues, event interceptors).
- Type escape hatches: `any` / `as` casts / `@ts-ignore` clusters — each one is a place the compiler was overruled (exclude generated types files).
- Resource leaks: unclosed handles, connections, subscriptions; missing `finally`.

## 2. Security

Review only what is directly supported by code evidence. Frame findings as defensive maintenance: identify the pattern, explain production impact, describe remediation as code/config/test changes. No runnable demonstration strings or misuse steps.

**Handling rule:** never copy a secret value into a finding or plan — those files may be committed. Reference `file:line` and credential type only ("Supabase service key at `config.ts:12`"), and always recommend rotation, not just removal.

**By-design is not a finding:** a tradeoff recorded in `.claude/scratch/tasks/lessons.md` or a convention in `.claude/rules/conventions-*` is settled. Flag only where the *implementation* adds risk beyond the documented decision.

- Credential hygiene: hardcoded keys/tokens, credentials in committed `.env`, secrets logged or persisted in event/audit/history stores. Name only type and location; recommend rotation + a safer config path (`packages/env`).
- **Row-Level Security (Supabase/Postgres):** the most important Carbon security surface. See Carbon checks — tables exposed without RLS, or using the **deprecated** `has_role(...) AND has_company_permission(...)` pattern, or missing tenant (`companyId`) scoping.
- Data crossing into interpreters: SQL assembled from request data (prefer Kysely/parameterized), HTML sinks fed user content (XSS — tiptap/printing surfaces), path traversal in file/storage handling.
- Access control: route actions/loaders lacking server-side identity checks, authorization only in the client, object access by ID without ownership/tenant checks (IDOR), missing CSRF protection on state-changing routes.
- Input contracts: action handlers that trust `formData`/JSON without a zod validator (see Carbon checks — forms), file uploads without type/size constraints, mass assignment into persistence models.
- Dependency posture: `pnpm audit` (read-only). Report only critical/high advisories affecting reachable runtime/build paths; skip low-signal noise.
- Production config: overly broad CORS with credentials, missing hardening headers where sensitive browser surfaces exist, cookies missing `HttpOnly`/`Secure`/`SameSite`, debug/verbose behavior in production config.
- Data minimization: PII or operational data in logs, stack traces returned to clients, internal error details in API responses.

## 3. Performance

Algorithmic and architectural wins, not micro-optimizations.

- N+1 patterns: query/fetch per item inside loops or per list-row render; missing batching. Common in service functions and loaders.
- Wrong complexity: nested scans over the same collection, repeated `find`/`filter` inside hot loops where a Map keyed lookup belongs.
- Caching gaps: identical expensive computations/fetches repeated per request/render; missing memoization at clear boundaries.
- Payload size: over-fetching (`select *`, full rows where IDs suffice), missing pagination on unbounded lists (Carbon Tables), large JSON shipped to clients.
- Frontend (React Router 7): bundle composition (heavyweight deps for trivial use), missing code-splitting on rarely-hit routes, client-side fetching for data available in the loader, render waterfalls, missing `useMemo`/stable keys in large tables.
- Backend: synchronous work that belongs in a job (`packages/jobs`), missing DB indexes implied by query patterns (flag for verification against the migration that creates the table — don't claim without schema evidence), per-request connections where pooling exists.
- Build/CI: turbo cache misses, redundant pipeline steps, slow test suites.

## 4. Test Coverage

The goal is not a percentage — it's *which untested code is dangerous*.

- Map the critical paths (inventory moves, costing, traceability, RLS-guarded mutations, the feature a package exists for) and check which have zero/trivial coverage.
- High-churn (git log) + no tests = top refactor risk; flag as "characterization tests first."
- Test quality: tests asserting nothing meaningful, heavy mocking that tests the mocks, snapshot tests nobody reads, flaky patterns (real timers/network, order dependence).
- Test infrastructure reality: most `packages/*` have vitest; **`apps/erp` has a `vitest.config.ts` but verify whether a `test` script and real suites exist** before assuming coverage is possible there. Pure functions often belong in a `packages/*` that already has vitest rather than in the app. (See `.claude/scratch/tasks/lessons.md` on this.)
- Verification baseline: is there a one-command way to know a package works? If not for the target package, that's finding #1 and a prerequisite plan.

## 5. Tech Debt & Architecture

- Duplication: the same logic re-implemented in 3+ places; divergent copies that have drifted. Distinguish genuine duplication from intentional erp-vs-mes divergence.
- Layering violations: UI importing data-layer internals, circular deps, `packages/utils`/`lib` junk-drawer growth with high fan-in.
- Dead code: unexported-and-unused modules, feature flags fully rolled out but still branching, commented-out blocks, manifest deps no longer imported.
- God objects/modules: files an order of magnitude larger than the median that everything touches; functions with deep conditional nesting.
- Inconsistent patterns: multiple ways of doing data fetching / error handling / styling in one app — pick the winner the team converged on most recently (check `.claude/rules/conventions-*`) and plan the consolidation.
- Abstraction mismatches: premature abstractions with a single implementation, or missing abstractions where the same change always touches N files in lockstep.
- **Service/models layout (Carbon):** see Carbon checks — logic that should live in module-level `*.service.ts` / `*.models.ts` but was split into ad-hoc files.

## 6. Dependencies & Migrations

- Major-version lag on core deps (React Router, Kysely, Supabase client, turbo, biome) where staying behind has real cost (EOL, security cutoffs).
- Deprecated APIs with announced removal timelines.
- Abandoned dependencies on critical paths.
- Duplicate deps solving the same problem.
- Lockfile/manifest drift, version pinning inconsistencies across the workspace.
- **Database migrations (Carbon):** see Carbon checks — the dominant "migration" surface here is Postgres schema migrations, not just npm deps. For each candidate, estimate blast radius (files/tables touched).

## 7. DX & Tooling

- Missing or broken per-package: typecheck script, biome config, test wiring.
- Slow feedback loops: dev startup, test startup, turbo cache not hit in CI.
- Onboarding friction: README/setup steps wrong, undocumented env vars (check `packages/env` + `.env.example`).
- **Agent knowledge gaps:** a subsystem with no `.claude/rules/` doc, or a convention not captured in `.claude/rules/conventions-*` — high leverage for an agent-driven repo. Recommend the rule/convention doc as a plan.
- Error messages/logging: unstructured logs, missing correlation IDs, debugging that requires code changes.

## 8. Docs

Lowest default priority — only flag where absence has a concrete cost:

- Published-package public API without reference docs.
- Architectural decisions nobody can reconstruct for actively-contested areas (prefer adding to `.claude/rules/` over scattered docs).
- Stale docs that are actively wrong (worse than missing) — including stale `.claude/rules/` entries that no longer match the code.

## 9. Direction — features & where to take this next

Forward-looking: what this codebase wants to become. **Grounding rule:** every suggestion must cite evidence from the repo — a suggestion that could apply to any ERP ("add AI", "add dark mode") is noise. **Check `.claude/scratch/recommendations/` first** and never re-propose what's on file. Sources of grounded signal:

- **Unfinished intent**: TODO/FIXME clusters around one theme, feature flags never rolled out, stubbed modules, abandoned mid-feature work in git history.
- **Stated-but-undelivered**: items in `.claude/scratch/recommendations/`, `.claude/scratch/tasks/*.md`, or rule docs describing intended direction the code hasn't caught up to.
- **Surface asymmetries**: one-directional pairs (export without import, create without bulk-create, a module with CRUD-minus-one), a capability one app has that the parallel app lacks (erp ↔ mes).
- **The adjacent possible**: capabilities the existing architecture makes disproportionately cheap — an MCP tool one service-function away (Carbon already exposes ~1187 MCP tools), a report one query from the existing service layer, an integration the data model already supports.
- **Friction worth productizing**: things users evidently do by hand around Carbon.

Direction findings use the standard format with two adaptations: **Impact** is product/user value (who wants this and why now), and **Confidence** reflects how grounded the evidence is. Plans for selected direction findings are usually a *design/spike plan*, not build-everything — scope them that way.

---

## Carbon-specific checks

High-value patterns unique to this repo. Most are codified in `.claude/scratch/tasks/lessons.md` and `.claude/rules/conventions-*` — read those for the authoritative version; a violation is a finding, conformance is not.

- **RLS policies** (`packages/database/supabase/migrations/`): every company-scoped table needs RLS using the **new** pattern — `get_companies_with_employee_permission('<perm>')::text[]` with standardized policy names (`"SELECT"`, `"INSERT"`, `"UPDATE"`, `"DELETE"`). Flag the **deprecated** `has_role('employee', "companyId") AND has_company_permission(...)` pattern and any company-scoped table with no RLS at all.
- **Migrations** must follow `.claude/rules/workflow-database-migration.md`: forward-only, fork functions from their latest version with `DROP ... IF EXISTS` then recreate preserving every attribute, randomize the `HHMMSS` in the timestamp (never `000000`), and **redefine views with `SELECT *` after adding columns** to a base table. Flag deviations.
- **Event-system interceptors**: registered via `attach_event_trigger(table, BEFORE[], AFTER[])`, which **DROPs and re-CREATEs** the trigger — a new registration that omits previously-registered interceptors silently detaches them. Flag any `attach_event_trigger` call that doesn't include the full prior set.
- **Supabase upsert audit fields**: `.upsert({ createdBy, updatedBy }, { onConflict })` clobbers `createdBy` on every update. Flag it; the fix is an explicit select-then-insert/update branch.
- **Upsert partial-submit clobbering**: an upsert helper that treats `undefined` as "clear the row" silently deletes data when a different form posts to the same action. `undefined` → no-op; explicit sentinel → clear. Also flag zod `.default()` on a field that should be `.optional()` (the default defeats the no-op).
- **`.merge()` after `.refine()`**: a refined zod schema is a `ZodEffects` and can't be `.merge()`d — flag base validators that will break downstream composition.
- **Enums**: use Postgres enums with capitalized, display-friendly values — not `TEXT` columns with ad-hoc strings.
- **GL accounts**: reference `accountId`, never the legacy `accountNumber`.
- **Tracked entities**: read `trackedEntity.readableId`; never parse Serial/Batch out of the `attributes` JSON.
- **Routes**: actions/loaders return plain objects — never `Response.json()`.
- **Detail/child routes**: render via `Outlet` in a **Drawer overlay**, not a Card below the table.
- **Forms**: `ValidatedForm` + a zod validator + existing form components from `packages/react`/`apps/erp/app/components/Form`. Flag hand-rolled forms or actions without a validator (see `.claude/rules/conventions-forms.md`).
- **Service/models layout**: add to module-level `<module>.service.ts` / `<module>.models.ts`; flag new standalone service/models files (see `.claude/rules/conventions-services.md`).
- **Transactions**: multi-row writes, reordering (`sortOrder`), and bulk inserts/updates must be atomic Kysely transactions — flag loops of individual writes that should be one transaction.
- **Component reuse**: new `bg-*`/`text-*`-heavy custom UI where a `packages/react/src/` or `apps/erp/app/components/` component already exists.
- **i18n**: user-facing strings should go through Lingui, not be hardcoded.

---

## Finding format

Every finding, from every category and subagent, comes back in this shape:

```markdown
### [CATEGORY-NN] Short imperative title

- **Evidence**: `path/file.ts:123` — one-sentence description of what's there. (Repeat per location; 2–5 strongest locations, note "and ~N similar sites" if widespread.)
- **Impact**: What goes wrong / what's being paid. Concrete: "every picking-list render issues 1+N queries", not "suboptimal".
- **Effort**: S (hours) / M (a day-ish) / L (multi-day) — for the *fix*, including tests.
- **Risk**: What the fix could break; LOW/MED/HIGH plus one line why.
- **Confidence**: HIGH (read the code, certain) / MED (strong signal, needs verification) / LOW (smell). LOW-confidence findings get an "investigate" plan, not a "fix" plan.
- **Fix sketch**: 1–3 sentences. Not the plan — just enough to judge effort honestly.
```

## Prioritization rubric

Order findings by **leverage = impact ÷ effort, discounted by confidence and fix-risk**. Tiebreakers:

1. Anything that unblocks other findings (verification baseline, characterization tests) floats up.
2. Security findings (especially RLS / tenant-isolation) with HIGH confidence float above equivalent-leverage non-security findings.
3. Prefer findings whose fix has a clean, **scoped** verification story (one package's typecheck + tests).
4. "Not worth doing" is a valid verdict; record it with one line of reasoning.
