# Extensibility and Upgrade-Safety Architecture

> Status: draft
> Author: carbon-agent (autonomous run — open questions resolved per spec-writing autonomous mode)
> Date: 2026-07-12

## TLDR

Carbon gets a platform-level extension architecture in which **the platform
owns schema and data integrity while extensions own behavior**. Extensions are
pnpm workspace packages that interact with core only through five sanctioned
surfaces: (1) named, versioned **hook extension points** (`before:` in-transaction
validation, `after:` async reaction), (2) semver'd **contract packages**
(`@carbon/contracts/*`) as the only importable API, (3) **manifest-declared
schema** generating real, typed, RLS'd Postgres side tables and namespaced
tables — never EAV, never ALTERs to core tables, (4) a **durable workflow
engine** (on the existing Inngest backbone) as the primary primitive for
multi-step processes, and (5) declared **UI slots and routes**. Module
isolation is enforced at lint, typecheck, and DB-role level. Upgrade safety is
an executable guarantee: contract tests in core CI plus a registry **corpus
gate** that runs extensions' suites against each release candidate —
**first-party extensions gate the release** (a red suite blocks merge to
main), while **community/third-party extensions are report-only** (failures
produce a report but never block a release) — so `carbon upgrade` is a
preflight-checked command, not a consulting project. Prior art: open-mercato's (MIT) contract discipline,
applied to a deep ERP domain — see `.ai/research/extensibility-architecture.md`.

## Problem Statement

Carbon has no sanctioned way to extend the system without forking it. A shop
that needs a coating-inspection step on receipts today must fork
`apps/erp`, edit core receipt UI and services, and add migrations to the core
chain — and then resolve merge conflicts on every upgrade, forever. The only
in-product mechanism is the `customFields` JSONB column on core tables:
untyped, unindexed, no FK integrity, invisible to reporting, and incapable of
expressing behavior (validation, processes) at all.

Every mature open-source ERP forces the same choice — customize deeply and
dread every upgrade, or stay vanilla and lose the reason you chose open
source:

- **ERPNext:** `hooks.py` + monkey-patching + metadata-level Custom Fields.
  Nothing is versioned or contract-tested; customizations break silently on
  upgrade.
- **Odoo:** `_inherit` patches core models and tables in place. Extensions
  couple to core internals by construction; major upgrades are the famous
  multi-week consulting project, with a paid migration service to prove it.
- **open-mercato:** clean DI module contracts (the right idea) but a young,
  shallow domain, and only partial answers on schema extension and upgrade
  impact analysis.

If Carbon wants an extension ecosystem (customer-specific compliance flows,
vertical add-ons, integrations) it needs an architecture where extending and
upgrading are not in tension — and it needs it before ad-hoc customizations
calcify into de-facto contracts.

## Proposed Solution

One core bet: **the platform owns schema and data integrity; extensions own
behavior.** An extension never touches a core table, never patches a core
function, and never imports another module's internals. In exchange, the
platform guarantees that a green contract-test suite today means a green suite
after `carbon upgrade` tomorrow.

This is deliberately stricter than ERPNext or Odoo. The cost of writing an
extension is paid once, at build time, by the author — instead of on every
upgrade, forever, by every customer.

Three behavioral surfaces, in order of preference (authors reach for the
highest one that solves the problem):

| Surface | Use when | Guarantee |
|---|---|---|
| **Workflows** | Multi-step business process reacting to system events | Durable, retried, compensable |
| **Hooks** | Single-step reaction or validation at a lifecycle point | Schema-validated payload, ordered execution |
| **Service interfaces** | Extension code needs to read/act on core data | Typed, versioned, semver-guaranteed API |

### Hook-based extension points

Core modules **declare** named extension points (they are not discovered),
each with a stable name `{module}.{entity}.{transition}` (e.g.
`inventory.receipt.posted`, `quality.nonConformance.opened`) and a versioned
zod payload schema. Two phases:

- **`before:` hooks** — synchronous, in-transaction, deterministically ordered
  (manifest `priority`, then extension name). May **validate** (throw a typed
  `HookVeto` to abort the operation with a user-facing message) or **augment**
  (patch the extension's own side-table data — never core columns). Hard
  budget of 250ms per hook and no external I/O, enforced by the SDK runtime.
- **`after:` hooks** — asynchronous, at-least-once, delivered through the
  existing Inngest event system after commit. Free to do I/O, call services,
  start workflows. Must be idempotent; payloads carry a stable `eventId`.

Payload schemas are additive within a major version; a breaking change
requires a new point version, with the old version delivered via a
core-maintained adapter through the deprecation window. Hooks are registered
in the extension manifest, so the platform knows statically which extension
consumes which point at which version — the basis for upgrade impact reports.

### Atomic post-commit event delivery: transactional outbox

`after:` hooks and workflow triggers depend on `inventory.receipt.posted@1`
(and every other point) actually reaching Inngest after the domain transaction
commits. The naive path — commit the domain write, then call
`inngest.send()` — has a lost-event window: if the process dies (or the Inngest
enqueue fails) *between* commit and send, the event is gone, the workflow never
starts, and `eventId` deduplication cannot help because there is no duplicate
to dedupe — the event was **never produced**. `eventId` dedup protects against
*duplicate* delivery (the relay sending the same event twice); it does **not**
recover an event that was never written.

Carbon closes this window with a **transactional outbox**:

- **Write the outbox record in the same DB transaction as the domain write.**
  When `post-receipt` commits the receipt, it also inserts a row into an
  `eventOutbox` table (event point + version, `companyId`, the versioned
  payload, a generated `eventId`, `status = 'pending'`) inside the *same*
  Kysely transaction. Either both land or neither does — the event's existence
  is now as durable as the business fact that produced it.
- **A background relay dispatches to Inngest.** A relay (an Inngest cron/poller
  in `@carbon/jobs`) polls `pending` outbox rows ordered by `(status,
  createdAt)`, calls `inngest.send()` with the stored `eventId`, and on ack
  marks the row `sent`. This decouples "the fact happened" (transactional) from
  "the fact was announced" (best-effort, retried). **Dispatch ordering is
  best-effort, not strict commit order.** `createdAt` is a wall-clock timestamp,
  not a commit sequence number — two transactions can commit in an order that
  differs from their `createdAt` values (clock skew, differing transaction
  durations), so polling by `(status, createdAt)` approximates but does not
  guarantee commit order. The guarantee this design actually provides is
  **at-least-once delivery with `eventId` deduplication**, *without* strict
  cross-event ordering. Consumers (`after:` hooks, workflows) must not assume two
  events arrive in the order their domain transactions committed. If strict
  per-aggregate ordering later becomes a hard requirement, the path forward is a
  per-aggregate monotonic sequence number (assigned inside the domain
  transaction) that the relay drains in sequence — that is explicitly **out of
  scope for this spec**, which needs only at-least-once + dedup.
- **Retry policy.** A failed relay send is retried with exponential backoff
  (e.g. base 2s, factor 2, jitter, cap ~5m) up to a bounded `maxRetries`
  (e.g. 8). `attemptCount` and `lastError` are recorded on the outbox row.
  Because the send carries a stable `eventId` and all `after:` hooks/workflow
  steps are idempotent, a retry that actually did succeed downstream is
  harmless.
- **Dead-letter handling.** After `maxRetries` the row moves to
  `status = 'dead'` (a dead-letter partition of the same table, or an
  `eventOutboxDeadLetter` table) with its full payload and error trail. Dead
  rows raise an admin alert on the workflow-observability surface and are
  replayable by an operator once the cause is fixed; they are never silently
  dropped.
- **What dedup does and does not cover.** `eventId` dedup (Inngest-side +
  idempotency keys on `after:` handlers) makes at-least-once delivery safe
  against the relay's duplicates. It is *orthogonal* to the outbox: the outbox
  guarantees the event is **produced exactly when the domain write commits**;
  dedup guarantees it is **consumed at most once in effect** even if delivered
  more than once. Neither alone is sufficient — the spec requires both.

The outbox lives in core (the platform owns the emission path); extensions
consume the resulting events and never touch the outbox directly. The
`eventOutbox` table is added to Data Model Changes below.

### Contract packages and reading core data

Every core module publishes a **contract package** — the only importable
surface: `@carbon/contracts/inventory`, `@carbon/contracts/quality`, etc.
Contracts contain typed service interfaces, read-model types, extension-point
payload schemas, and error types. No implementation, no DB types, no Kysely.
Implementations are bound by a service registry at startup; extension code
receives services through `HookContext`/`WorkflowContext`, tenant-scoped by
construction (`companyId` injected from context, never passed by the caller).

Extensions never query core tables. Two sanctioned read paths: read models via
service interfaces (stable projections, so core can refactor columns freely),
and published SQL views (`contract."salesOrders_v1"`) for reporting/bulk
access.

### Schema extension without EAV

Every piece of extension data lives in a real, typed, platform-generated
Postgres table inside the extension's **own dedicated Postgres schema**
(`ext_<camelCaseSlug>`, e.g. `ext_coatingInspection`) — never in `public`
alongside core tables. The schema, not a name prefix, is the privilege boundary
(see Security and access control). Two shapes:

- **Entity augmentation — side tables.** Adding fields to a core entity
  generates a 1:1 side table (e.g. `ext_coatingInspection.receiptLine`) keyed
  `(id, companyId)` to the core row with a composite FK and `ON DELETE CASCADE`.
  Core tables are never ALTERed; orphaned extension data is impossible. Declared
  augment fields auto-render at the entity's form slot.
- **New entities — schema-owned tables** (`ext_<camelCaseSlug>.<tableName>`)
  with the full platform conventions: `id('prefix')`, `companyId`, composite PK,
  RLS, audit columns. Extensions get a scoped, typed Kysely client covering
  **their schema only**, backed by a runtime DB role whose grants do not extend
  outside that schema.

Authors do not write SQL. They declare schema in the manifest; `carbon ext
generate` diffs against the last generated version and emits a numbered,
immutable, checksummed migration into the extension package. The first
migration for an extension also scaffolds the extension's dedicated schema
(`CREATE SCHEMA ext_<camelCaseSlug>`) and its two least-privilege roles with
schema-scoped grants (see Security and access control) — authors never write
`CREATE ROLE`/`GRANT` either. The generator statically rejects references to
non-contract core relations, triggers on core tables, and any DDL targeting a
schema other than the extension's own — the generated SQL is the only SQL an
extension can ship.

#### Canonical schema- and table-name normalization

Schema and table identifiers are **generated deterministically** from the
manifest, never authored, so the same manifest always yields the same physical
names across implementations. The rules are canonical:

- **Slug normalization.** The manifest `slug` is kebab-case
  (`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`) — it must start with a letter and every
  hyphen must be followed by at least one alphanumeric character, so **trailing
  hyphens (`foo-`) and consecutive hyphens (`foo--bar`) are rejected** at
  manifest validation. It is normalized to a camelCase identifier segment by
  removing each hyphen and upper-casing the following character
  (`coating-inspection` → `coatingInspection`). No other transformation (no
  case folding of the first character, no stripping of digits).
- **Schema name and table pattern.** Every extension owns one schema named
  **`ext_<camelCaseSlug>`** and all of its tables live inside it as
  **`ext_<camelCaseSlug>.<tableName>`**, where `<tableName>` is the manifest's
  table key (side tables use the augmented core table's name, e.g.
  `receiptLine`; owned entities use the author-declared table key, validated
  against the same `^[a-z][a-zA-Z0-9]*$` shape). Thus manifest slug
  `coating-inspection` augmenting `receiptLine` **must** derive schema
  `ext_coatingInspection` and table `ext_coatingInspection.receiptLine` — the
  example below is generated from exactly this rule, not hand-picked.
- **63-byte limit handling.** PostgreSQL truncates identifiers at 63 bytes, and
  the limit applies to the schema name and each table name *independently*
  (they are separate identifiers). The generator computes each identifier and,
  **if one exceeds 63 bytes**, deterministically truncates the variable portion
  and appends a short hash suffix of the *pre-truncation full name*
  (`…_<base36(hash)[0..6]>`) so the result stays unique and stable. If even the
  fixed part + hash cannot fit (pathologically long slug or table key), it is a
  **manifest validation error** telling the author to shorten the slug/table
  key — the generator never emits an identifier Postgres would truncate on its
  own.
- **Collision detection.** Because each extension lives in its own schema, two
  tables *within* one extension collide only if they normalize to the same
  table name (a hard manifest validation error at `carbon ext generate`), and
  cross-extension table-name overlap is impossible by construction — different
  schemas. The globally-unique identifier is therefore the **schema name**: two
  slugs that normalize to the same `ext_<camelCaseSlug>` schema (or the same
  name after 63-byte truncation + hashing) are a **hard manifest/registry
  validation error** at `carbon ext generate`/`publish` time. The corpus
  registry reserves schemas by the **normalized** name, not the raw slug, so no
  two extensions can claim the same schema.

Because names are a pure function of the manifest, the generator, the migration
applier, the scoped Kysely client's type generation, and the conformance
checker all derive the identifiers the same way — there is no second source of
truth to drift.

### Module isolation at package boundaries

One rule: a module (core or extension) may import another module **only
through its contract package**. Enforced three times, because convention does
not survive contact with deadlines:

1. **Lint** — boundary rules: extension packages may import only
   `@carbon/extension-sdk`, `@carbon/contracts/*`, their own files, and
   declared npm deps; core modules get the mirror-image rule.
2. **Typecheck** — internal types are not exported from module barrels; the
   scoped Kysely client makes out-of-schema table access a type error.
3. **Runtime** — the schema-scoped DB role (grants confined to
   `ext_<camelCaseSlug>`) and tenant-scoped service registry make the first two
   non-bypassable even by dynamic code.

Extensions may depend on other extensions only if the dependency publishes its
own contract; the platform topologically orders install/migration/hook
execution by the declared graph and rejects cycles.

Everything an extension contributes is enumerable from its manifest: hooks,
workflows, schema, UI routes (`/x/{slug}/...`) and slots, permissions
(`{slug}_{action}`, managed by core RBAC), settings (rendered by core settings
UI), and crons. Notably absent by design: middleware on core routes, patching
core components, raw SQL, service overrides. If a real use case can't be
expressed, the answer is a new extension point in core — a PR, not a
workaround.

### Security and access control

Extensions run privileged code and own real tables, so authorization is part of
the architecture, not an afterthought. Four boundaries:

**Hook and workflow registration.** Registration is **static, not dynamic** —
hooks, workflows, crons, routes, and schema are declared in an extension's
`manifest.ts` and bound at build/install time; there is no runtime "register a
hook" API for arbitrary callers to reach. Installing or enabling an extension
for a company is a privileged operation gated by a core permission
(`extensions_install` / `extensions_update`, held by company admins), enforced
by `requirePermissions` on the Settings → Extensions route. At runtime the
dispatcher only invokes hooks whose owning extension is present in the signed,
build-time manifest set **and** enabled for the event's `companyId` (via
`extensionInstall`); hooks are not authenticated by a caller-supplied token —
their authority derives from the manifest binding and the per-company enable
record, both of which the platform, not the extension, controls.

**Extension code sandbox (v1 threat model).** v1 runs extension code
**in-process with the app** (see Open Questions H-runtime): `before:` hooks and
Inngest-backed `after:` hooks/workflows execute in the app's Node process. This
is acceptable in v1 *only because the gating corpus is first-party/reviewed
code*, not arbitrary untrusted uploads. The runtime restricts extensions by
capability rather than OS sandboxing: extension code receives its powers solely
through injected `HookContext`/`WorkflowContext` (tenant-scoped contract
services + the schema-scoped Kysely client) and may import only
`@carbon/extension-sdk`, `@carbon/contracts/*`, and declared npm deps — no
`@carbon/database`, no core service internals, no ambient DB handle (enforced at
lint + typecheck, backstopped by the DB role). `before:` hooks additionally get
a hard 250ms budget and a **no-external-I/O** restriction enforced by the SDK
runtime, bounding the blast radius on hot posting paths. Out-of-process/worker
isolation is the documented upgrade path for when the corpus admits untrusted
third-party code (manifest/contract design is placement-agnostic, so it lands
without contract changes) — and is a **hard prerequisite** before any unreviewed
community extension is allowed to execute (as opposed to today's report-only
corpus, which only runs tests, never production hooks).

**Schema-extension DDL authorization.** The privilege boundary is a real
PostgreSQL **schema**, not a name prefix — a `ext_*` naming convention alone
grants no isolation, because any role with rights on `public` could touch a
`public.ext_foo_bar` table regardless of what it is called. Instead, each
extension owns a dedicated schema `ext_<camelCaseSlug>` and gets **two
least-privilege roles**, both scaffolded by the generator (never authored) and
granted only against that one schema:

- **Migrator role (`ext_<slug>_migrator`)** — `CONNECT` plus `CREATE`, `ALTER`,
  and `DROP` **only inside schema `ext_<camelCaseSlug>`** (`GRANT ... ON SCHEMA
  ext_<camelCaseSlug>`), and no `CREATE` on any other schema. It may reference
  core relations in `public` **only** as FK targets (a grant that permits the
  `REFERENCES` privilege, never `ALTER`/`DROP` on them). Extension migrations are
  applied by the platform's **migration applier** (in `extension-host`) as this
  role — never by the extension, the app's request-time role, or a superuser.
- **Runtime role (`ext_<slug>_runtime`)** — `SELECT`/`INSERT`/`UPDATE`/`DELETE`
  on the extension's tables **inside `ext_<camelCaseSlug>` only**, with **no DDL
  grants at all** and no `CREATE` on any schema. This is the role the scoped
  Kysely client connects as on the request path, so a compromised extension at
  runtime cannot alter schema, and the migrator role is never reachable from a
  request.

Core schema (`public`) and every *other* extension's schema are off-limits to
both roles: neither is granted `USAGE`/`CREATE` on another `ext_<...>` schema,
and read/write access to core data is only ever through the sanctioned contract
views (themselves granted explicitly to the runtime role). The generator is
still the single emitter of DDL and statically rejects any statement targeting a
schema other than the extension's own, any trigger on a core table, or any
`ALTER` of a core relation before the SQL is emitted — so the schema-scoped
roles are a defense-in-depth backstop enforced by Postgres itself, not the first
line.

**Uninstall / removal safety.** Removal never runs author-supplied teardown
SQL. Uninstall defaults to **archive** — non-destructive and reversible — which
does three things atomically:

1. **Rename the schema** `ext_<camelCaseSlug>` → `ext_removed_<camelCaseSlug>`
   and revoke the runtime role's grants, so the extension's code and RLS no
   longer reach the data.
2. **Sever the live FK to core.** Every extension→core FK is generated
   `ON DELETE CASCADE` (on the *extension* side only — core rows reference
   nothing in `ext_*`), which means that while the archived data still carries a
   live cascade FK, a later delete of the referenced core row would **silently
   destroy the archived extension data** — breaking the reversibility guarantee.
   Archive therefore neutralizes the FK before it can fire. The choice depends on
   table shape:
   - **Side tables** key `(id, companyId)` to core as *both* the primary key and
     the FK, so the columns cannot be nulled. Archive **drops the FK
     constraint** outright; the `id`/`companyId` values are retained as plain
     recorded data (no longer enforced against `public`), so a subsequent core
     delete cannot cascade into the archive.
   - **Owned entity tables** that merely *reference* a core row through a
     nullable FK column have the constraint converted to **`ON DELETE SET NULL`**
     (preferred) — the archived row survives a core delete with the reference
     cleared. `ON DELETE RESTRICT` is available where the reference must not be
     silently lost, at the cost of blocking the core delete until reconciled.
3. **Leave all rows in place** — no `DELETE`, no `TRUNCATE`.

Restoration (re-enabling an archived extension) renames the schema back and
re-establishes each severed FK **only where the referenced core row still
exists**; if a core row was deleted while the extension was archived, the
dependent side-table/entity row is **orphaned** and restoration leaves it with
the FK unre-established, flagged for an admin to reconcile (delete the orphan or
re-point it) rather than silently dropping it. (A future variant may instead
copy archived data into a fully detached structure with no FK to core at all;
either way the FK lifecycle is explicit and no core delete ever destroys
archived data.)

**Drop** is a separate, destructive, double-confirmed action. DDL for removal
is generated and schema-scoped exactly like install (targeting only
`ext_<camelCaseSlug>`), so an extension cannot script a `DROP` of a core object
or another extension's table during uninstall. Disabling an extension is
instantaneous and non-schema-touching: it flips `extensionInstall.enabled`,
which immediately stops hook/workflow dispatch while leaving data intact.

### Workflow engine as a first-class extension primitive

Most manufacturing extensibility needs are processes, not single steps:
"when a receipt posts for a coated part, create an inspection, notify quality,
wait for disposition, and on failure quarantine the lot and open an NCR."
Hand-rolling that with hooks means hand-rolling persistence, retries,
timeouts, and cleanup — the graveyard of every plugin ecosystem.

Workflows are TypeScript definitions (`defineWorkflow`) registered in the
manifest: a typed trigger (`on("inventory.receipt.posted@1", { filter })`),
named steps calling contract services, `waitForEvent("quality.inspection.dispositioned@1", …)`/`sleep`
with timeouts, and per-step saga-style compensators. **Every event reference —
in a trigger or a `waitForEvent` — must carry a version suffix
(`{point}@{version}`).** An unversioned reference is a manifest validation
error: it would silently accept whatever payload shape the point currently
emits, so the moment the point ships a `@2` the workflow would receive an
incompatible payload with no signal. The version pins the workflow to a
payload schema the platform can guarantee. The platform (executing on the existing
Inngest durable-execution backbone, not a bespoke runner) guarantees
durability (crash-resume, never restart), per-step retries with idempotency
keys, versioning (in-flight runs finish on the version they started),
observability (per-company, per-extension run/step/retry admin surface), and
tenancy (runs are companyId-scoped; triggers fire per company with the
extension enabled).

**Event-version compatibility resolver.** When a workflow references
`{point}@{v}`, the platform resolves the reference at dispatch time:

- **`@v` still emitted** — deliver the native `@v` payload. Normal case.
- **`@v` deprecated but within its window** — the point now emits `@v+1`
  natively; core delivers `@v` to this workflow through the
  **core-maintained backward-compatible adapter** for that point (the same
  adapter the deprecation policy requires). The workflow is unaware anything
  changed. A structured deprecation warning is emitted, attributed to the
  consuming extension, and the corpus impact report names it.
- **`@v` past its deprecation window / no adapter** — the reference is
  **unresolvable**. It is caught statically first: the corpus gate's impact
  report flags any workflow referencing a version the RC no longer supports,
  and `carbon upgrade` preflight marks that extension `incompatible`. Such a
  workflow will not arm its trigger; upgrading past the window requires the
  extension to **explicitly opt in** by publishing a new version that
  references `@v+1` (with its own migration if the payload shape it consumes
  changed). Upgrades are never silent — the platform maintains
  backward-compatible shims *within* the window and forces an explicit opt-in
  *past* it.

This is also the most upgrade-safe surface: a workflow touches core only
through events in and service calls out — both versioned contracts.

### Upgrade safety: contract tests and the corpus gate

What is versioned, and what a breaking change costs:

| Surface | Versioning | Breaking change requires |
|---|---|---|
| Extension-point payloads | Major version per point | New point version + adapter through deprecation window |
| Contract packages | Semver | Major bump + codemod/migration note |
| Extension SDK | Semver | Major bump, N−1 supported |
| Contract SQL views | Suffixed (`_v1`, `_v2`) | New view; old maintained through window |
| Workflow definitions | Per-workflow integer | In-flight runs pinned to their version |
| Extension schema | Per-extension integer | Forward-only migrations |

Deprecation policy: one major core release of continued function, structured
runtime warnings attributed to the consuming extension, and a release-note
entry with the replacement. This extends the existing
`BACKWARD_COMPATIBILITY.md` contract surfaces (FROZEN event types, STABLE
service signatures, ADDITIVE-ONLY schema) with mechanical enforcement.

Two executable suites: **platform-side** contract tests in core CI (payloads
match schemas at emission via golden fixtures per version; services behave per
contract including error contracts; a core PR changing behavior behind a
contract fails CI unless it bumps the version and adds the adapter), and
**extension-side** `carbon ext test` (a real ephemeral Postgres + platform
runtime: migrations from zero and from each historical version, golden
fixture events, workflow paths including timeout and compensation branches).

The decisive mechanism is the **corpus gate**: core CI maintains a registry
corpus of published extensions' manifests + contract tests (first-party
always; community opt-in). Every core release candidate gets a static pass
(diff every manifest against the RC's contract versions → machine-generated
impact report) and a dynamic pass (run every corpus suite against the RC).

The gate has **two tiers with different consequences**, so a flaky or broken
third-party suite can never hold the release hostage:

- **First-party extensions gate the release.** A red first-party corpus suite
  (or a static impact report flagging an unversioned breaking change against a
  first-party consumer) **blocks merge to main**. It must produce a fix, an
  adapter, or an explicit breaking-changes entry with remediation before the
  RC can ship.
- **Community/third-party extensions are report-only.** Their suites run
  against the RC and their results are published in the impact report, but a
  red community suite **does not block the release**. It surfaces the breakage
  (and notifies the extension author) so it can be remediated on the
  extension's own timeline; the community bar to enter the report-only corpus
  is a green `carbon ext test`, manifest lint, and semver discipline.

Silent breakage — a first-party consumer broken with no report — is the
failure mode this architecture exists to eliminate; the report-only tier
extends visibility to the community without transferring their test health
onto core's release path.

### Competitor comparison

Full findings: `.ai/research/extensibility-architecture.md`. Prior art
credit: open-mercato (MIT License, © 2025–2026 Open Mercato contributors,
<https://github.com/open-mercato/open-mercato>) — its DI module-contract
discipline is the closest existing implementation of the isolation model
proposed here.

| Dimension | ERPNext | Odoo | open-mercato | Carbon (this spec) |
|---|---|---|---|---|
| Extension mechanism | `hooks.py`, monkey-patching, server scripts | ORM `_inherit` — patch core in place | Clean DI module contracts | Declared hooks + versioned contracts; no override mechanism at all |
| Custom fields | DocType metadata (EAV-flavored) | ALTERs core tables via inheritance | Limited | Platform-generated typed side tables; core tables never touched |
| Extension migrations | Fixtures + patches, hand-maintained | Hand-maintained, breaks across versions | Basic | Generated from manifest, numbered, checksummed, platform-applied |
| Module isolation | Convention only | Effectively none | Good (package boundaries) | Enforced at lint + type + DB-role level |
| Upgrade safety | Manual; breaks routinely | Multi-week consulting project | Better, but young | Semver'd surfaces + deprecation windows + corpus contract tests per release |
| Process automation | Server scripts, basic workflow states | Automated/server actions (imperative) | — | First-class durable workflow engine (persistence, retries, `waitForEvent`, compensation) |
| Multi-tenancy in extensions | Site-per-tenant | DB-per-tenant or none | Row-level | Row-level, generated into every table + tenant-scoped services, non-optional |
| Static upgrade impact analysis | No | No | Partial | Yes — manifests make every dependency machine-readable |

One line: open-mercato's contract discipline, applied to a real ERP, with
schema extension solved structurally instead of via EAV, and upgrade safety
made an executable guarantee instead of a hope. The honest cost: a Carbon
extension takes more upfront learning than an Odoo patch. Accepted — "easy to
hack" and "easy to operate for a decade" are different products.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| H1: Multi-tenancy on new tables | Yes — every generated extension table and every platform table carries `companyId`, composite PK `("id", "companyId")`, `id('prefix')` default; generated, not author-written. Exception: `extensionMigration` and `extensionRegistry` are DB-level (schema is physical and shared across tenants), documented below. | Tenancy must be non-optional for third-party code; the generator is the only way it stays uniform. The two DB-level tables record facts about the database itself, not tenant data. |
| H2: Service shape | Platform-side service functions (install/enable/settings) follow the standard: `client` first arg, return `{ data, error }`, never throw, `companyId`-scoped. Contract services exposed to extensions are interface-based and tenant-scoped via context instead — they throw typed contract errors. | Core app code stays on Carbon conventions; the extension-facing surface needs typed errors and injected tenancy so extensions physically cannot pass a foreign `companyId`. |
| H3: RLS coverage | Every generated extension table gets the four standard policies (`SELECT` via `get_companies_with_employee_role()`, write policies via `get_companies_with_employee_permission('{slug}_{action}')`), emitted by the generator. Platform tables get the same hand-written per `.ai/rules/conventions-database.md`. | RLS on third-party tables cannot be left to authors; generation makes it a conformance-checkable invariant. |
| H4: Permission scoping | Extension permissions are `{slug}_{action}`, registered in core RBAC at install; extension routes call `requirePermissions` with them; permission scope strings remain FROZEN per `BACKWARD_COMPATIBILITY.md`. | Reuses the existing RBAC machinery end-to-end; no parallel permission system. Slug-derived naming prevents collisions with core module scopes. |
| H5: Form pattern | Declared augment fields auto-render in the core entity's form (zero extension UI code); extension-authored route forms use `ValidatedForm` + `validator(zodSchema)` + route actions like any Carbon form. | One form system; the manifest gives the platform enough type information to render augments without custom code. |
| H6: Module layout | N/A as stated for ERP modules — extensions are workspace packages under `extensions/{slug}` (package `carbon-ext-{slug}`), not `apps/erp/app/modules/*`. The analogous convention: one `manifest.ts` (single source of truth), optional `contract.ts`, `hooks/`, `workflows/`, `ui/`, `services/`, immutable `migrations/`, `AGENTS.md`. | The whole point is that extensions live outside the app at a package boundary; the ERP module layout governs core modules, which are unchanged. |
| H7: Backward compatibility | This spec touches no existing FROZEN/STABLE surface — it adds new ones. Contract packages, extension-point payloads, SDK, and contract views become versioned surfaces with the deprecation policy above; `BACKWARD_COMPATIBILITY.md` gains a section enumerating them. Existing `customFields` JSONB is untouched (see Open Questions). | Extensibility is only real if the new surfaces inherit — and mechanize — the existing compatibility contract rather than bypassing it. |
| Schema extension mechanism | Generated 1:1 side tables + namespaced owned tables; **no EAV, no JSONB growth, no ALTERs to core tables** | ERPNext's metadata fields and Odoo's in-place ALTERs are the two documented failure modes (see research); side tables give real types, FKs, indexes, and RLS with cascade-safe cleanup. |
| Override capability | None. Hooks can veto and augment; nothing can replace core behavior in place | The absence of an override mechanism is what makes upgrade guarantees possible; core fixes belong upstream (it's open source). |
| Extension SQL authoring | Authors declare schema in the manifest; `carbon ext generate` emits numbered, immutable, checksummed migrations; no hand-written SQL escape hatch | Every convention (naming, RLS, bare `NUMERIC`, tenancy) becomes generator-enforced instead of review-enforced. |
| Workflow backbone | Inngest (existing `@carbon/jobs` infrastructure), wrapped in a typed `defineWorkflow` SDK | Codebase precedent — durability, retries, and `waitForEvent` already exist in production; a bespoke runner would duplicate them. |
| Hook delivery | `before:` in-transaction (250ms budget, no I/O); `after:` via the event system, at-least-once, idempotent | Validation needs transactional veto; everything slow or fallible belongs on the durable async path. Mirrors the existing event-system split. |
| Isolation enforcement | Lint + typecheck + runtime DB role, all three | Any single layer is bypassable; the DB role is the backstop that holds even for generated/dynamic code. |
| Runtime placement (v1) | In-process with the app | Autonomous resolution — see Open Questions. |
| Dynamic/hot plugin loading | Out of scope for v1 — extensions are workspace packages resolved at build time | Manifest design keeps the door open; runtime loading adds sandboxing problems v1 doesn't need. |
| UI extension surface | Declared slots + namespaced routes only; no theming/patching of core screens | Arbitrary UI patching is the front-end version of `_inherit` — same upgrade coupling. |

## Data Model Changes

New platform tables (hand-written, in the core migration chain):

```sql
-- Which extensions are enabled for which company, with their settings.
CREATE TABLE "extensionInstall" (
    "id" TEXT NOT NULL DEFAULT id('extin'),
    "companyId" TEXT NOT NULL,
    "extensionSlug" TEXT NOT NULL,          -- e.g. 'coating-inspection'
    "version" TEXT NOT NULL,                -- installed extension version
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "settings" JSONB,                       -- structured; see note below
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    -- NOTE: no "customFields" JSONB column. Carbon's default table template
    -- ships one, but this spec's core principle rejects unstructured JSONB
    -- growth, so platform tables introduced by this spec deliberately omit it.
    -- The only JSONB here is "settings", which is NOT an unstructured escape
    -- hatch: it is written by the Settings → Extensions install/settings flow
    -- (core, service-role) and read by the extension host; every value is
    -- validated at write time against the manifest's declared settings schema
    -- (Zod), and its shape is versioned with the extension. It is structured
    -- config keyed by a known schema, not open-ended custom fields.
    CONSTRAINT "extensionInstall_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "extensionInstall_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "extensionInstall_unique" UNIQUE ("companyId", "extensionSlug")
);
CREATE INDEX "extensionInstall_companyId_idx" ON "extensionInstall" ("companyId");
ALTER TABLE "extensionInstall" ENABLE ROW LEVEL SECURITY;
-- Standard four policies per conventions-database.md:
-- SELECT via get_companies_with_employee_role();
-- INSERT/UPDATE/DELETE via get_companies_with_employee_permission('settings_<action>')

-- Applied extension migrations. DB-level by design (documented H1 exception):
-- schema is physical and shared across all tenants in the database.
CREATE TABLE "extensionMigration" (
    "id" TEXT NOT NULL DEFAULT id('extmg'),
    "extensionSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,             -- the extension's schema version
    "checksum" TEXT NOT NULL,               -- detects edited/tampered migration files
    "appliedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "extensionMigration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "extensionMigration_unique" UNIQUE ("extensionSlug", "version")
);
-- RLS enabled, no permissive policies: service-role/installer access only.
ALTER TABLE "extensionMigration" ENABLE ROW LEVEL SECURITY;

-- Transactional outbox for atomic post-commit event delivery. A row is written
-- in the SAME transaction as the domain write that produces the event; a relay
-- (@carbon/jobs cron) dispatches pending rows to Inngest and marks them sent.
CREATE TABLE "eventOutbox" (
    "id" TEXT NOT NULL DEFAULT id('evtob'),
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,                 -- stable dedup key carried to Inngest
    "eventPoint" TEXT NOT NULL,              -- versioned, e.g. 'inventory.receipt.posted@1'
    "payload" JSONB NOT NULL,                -- the versioned, schema-validated payload
    "status" TEXT NOT NULL DEFAULT 'pending',-- 'pending' | 'sent' | 'dead'
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "sentAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "eventOutbox_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "eventOutbox_eventId_unique" UNIQUE ("eventId")
);
-- Relay polls by (status, createdAt): best-effort ordering, NOT strict commit
-- order (createdAt is wall-clock, not a commit sequence). Guarantee is
-- at-least-once delivery + eventId dedup, without cross-event ordering.
CREATE INDEX "eventOutbox_pending_idx" ON "eventOutbox" ("status", "createdAt");
-- RLS enabled, no permissive policies: written by the emitting domain
-- transaction (service-role) and drained by the relay only.
ALTER TABLE "eventOutbox" ENABLE ROW LEVEL SECURITY;
```

Dead-lettered events (status `'dead'` after `maxRetries`) retain their full
`payload` and `lastError` for operator replay from the workflow-observability
surface; they are never dropped.

Example of **generated** extension SQL (emitted by `carbon ext generate`,
never hand-written) — a side table augmenting `receiptLine`:

```sql
-- The extension's dedicated schema and its two least-privilege roles are
-- scaffolded by the first generated migration (never hand-written). Grants are
-- confined to this one schema — the privilege boundary is the schema, not the
-- name prefix.
CREATE SCHEMA IF NOT EXISTS "ext_coatingInspection";
-- CREATE ROLE "ext_coatingInspection_migrator";   -- CREATE/ALTER/DROP in schema only
-- CREATE ROLE "ext_coatingInspection_runtime";    -- SELECT/INSERT/UPDATE/DELETE in schema only
-- GRANT USAGE, CREATE ON SCHEMA "ext_coatingInspection" TO "ext_coatingInspection_migrator";
-- GRANT USAGE ON SCHEMA "ext_coatingInspection" TO "ext_coatingInspection_runtime";
-- (no grants to either role on "public" or any other ext_* schema; REFERENCES
--  on core FK targets only, contract views granted explicitly to runtime)

CREATE TABLE "ext_coatingInspection"."receiptLine" (
    "id" TEXT NOT NULL,                     -- = receiptLine.id (1:1)
    "companyId" TEXT NOT NULL,
    "coatingSpec" TEXT,
    "cureTempC" NUMERIC,                    -- bare NUMERIC per conformance rules
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "receiptLine_pkey" PRIMARY KEY ("id", "companyId"),
    -- Live FK is ON DELETE CASCADE (extension side only). At ARCHIVE time this
    -- constraint is DROPPED (the id/companyId columns are also the PK and cannot
    -- be nulled), so a later delete of the core receiptLine can never cascade
    -- into and destroy archived extension data. See Uninstall / removal safety.
    CONSTRAINT "receiptLine_id_fkey" FOREIGN KEY ("id", "companyId")
      REFERENCES "public"."receiptLine"("id", "companyId") ON DELETE CASCADE
);
-- Full audit columns are generated on EVERY extension table, side tables
-- included: createdBy/updatedBy are user FK references, matching Carbon's DB
-- conventions and the acceptance criterion below. Side tables are 1:1 with a
-- core row but are still independently written by extension hooks/forms, so
-- "who set the coating spec" is a distinct fact from "who created the receipt
-- line" — the user references are not redundant with the core row's audit.
-- + generated RLS (four standard policies on '{slug}_{action}' permissions),
-- + generated companyId index. Core tables are never ALTERed.
```

Extension-owned entity tables (`ext_<camelCaseSlug>.<tableName>`) follow the
full platform template (`id('prefix')`, `companyId`, composite PK, RLS, audit
columns), all generated. Uninstall offers **archive** (rename the schema to
`ext_removed_<camelCaseSlug>`, revoke access, and sever the live core FK —
drop it on side tables, convert it to `ON DELETE SET NULL` on nullable entity
references — so no later core delete destroys archived data; the default) or
**drop** (destructive, double-confirmed). Downgrade is unsupported; migrations
are forward-only.

No changes to any existing core table.

## API / Service Changes

New packages:

- **`packages/extension-sdk/`** (`@carbon/extension-sdk`) — `defineExtension`
  (manifest schema + validation), `defineHook`/`HookVeto`, `defineWorkflow`/
  `step`/`waitForEvent`, `HookContext`/`WorkflowContext`, the scoped Kysely
  client factory, and the `carbon ext` test harness.
- **`packages/contracts/{module}/`** (`@carbon/contracts/*`) — per-module
  service interfaces, read models, extension-point payload schemas, error
  types. Types and zod only; no implementation.
- **`packages/extension-host/`** — service registry (binds contract
  interfaces to module implementations at startup, wraps calls with tenant
  scoping), hook dispatcher (`before:` in-transaction, `after:` via
  `@carbon/jobs` events), workflow runtime bindings, manifest loader,
  migration applier.

New CLI (`carbon ext`): `generate` (manifest diff → numbered migration),
`test` (ephemeral Postgres + runtime: migrations from zero and from each
prior version, golden fixtures, workflow branches), `publish` (registry +
corpus), `add` / `enable --company` (install + per-company enablement).

Core module changes: each module that publishes extension points emits them
at the declared lifecycle sites (e.g. `post-receipt` emits
`inventory.receipt.posted@1` with its versioned payload) and ships platform-side
contract tests. App services for the new platform tables live in a new
`extensions` settings module following the standard service shape (client
first, `{ data, error }`, `companyId`-scoped).

CI changes: boundary lint rules; corpus gate job on release candidates
(static impact report + dynamic corpus suite run).

## UI Changes

- **Settings → Extensions** page (ERP): installed extensions per company,
  enable/disable, manifest-driven settings forms (`ValidatedForm`), lossy-
  migration acknowledgments during upgrade, uninstall (archive/drop) flow.
- **Extension routes** mounted at `/x/{slug}/...`, built from `@carbon/react`
  components, gated by `{slug}_{action}` permissions.
- **UI slots** rendered by core screens at declared points — v1 inventory:
  entity detail panels, table columns, and action menus for the top ~10
  entities (see Open Questions). Declared augment fields auto-render on the
  entity's form.
- **Workflow observability** admin surface: runs, steps, retries,
  compensations per company and per extension, payloads redacted per the
  manifest's data classification.
- Deprecation warnings surfaced in the admin UI, attributed to the consuming
  extension.

## Acceptance Criteria

- [ ] A reference extension (`carbon-ext-coating-inspection`: one augment, one
      owned table, one `before:` hook, one workflow, one slot, one route)
      installs on a clean local stack via `carbon ext add` + `enable`, and
      `carbon ext test` passes its migrations from zero and from each prior
      schema version against a real ephemeral Postgres.
- [ ] Posting a receipt containing a coated part without a coating spec is
      aborted by the `before:` hook's `HookVeto`, the user sees the hook's
      message, and no receipt or ledger rows are written.
- [ ] Posting a valid coated receipt starts the inspection workflow; killing
      the app process mid-run and restarting resumes the run at the last
      completed step (no duplicate inspection is created).
- [ ] A workflow run parked on `waitForEvent("quality.inspection.dispositioned@1", …)`
      resumes when the matching `quality.inspection.dispositioned@1` event
      fires, and routes to its declared timeout handler when the timeout
      elapses.
- [ ] Every generated extension table — owned entities **and** side tables —
      has `companyId`, composite PK, the four standard RLS policies, and the
      full audit columns including `createdBy`/`updatedBy` user FK references
      to `user("id")` — verified by the `@carbon/checks` conformance suite with
      zero manual SQL edits (side tables are explicitly not exempt).
- [ ] With two companies on one database and the extension enabled for only
      one, users of the other company see no extension UI, cannot read
      extension tables (RLS), and trigger no extension hooks or workflows.
- [ ] An extension source file containing
      `import ... from "~/modules/inventory/inventory.service"` or
      `import { Database } from "@carbon/database"` fails `pnpm run lint`;
      a query against a table outside the extension's schema
      (`ext_<camelCaseSlug>`) through its scoped client fails typecheck; the
      same query issued dynamically at runtime is rejected by the DB role.
- [ ] Editing a committed file under an extension's `migrations/` causes
      install/upgrade to fail with a checksum error.
- [ ] A core PR that changes an emitted extension-point payload without
      bumping the point version fails the platform-side contract tests in CI.
- [ ] The corpus gate, run against a release candidate that deprecates
      `inventory.receipt.posted@1`, produces an impact report naming every
      corpus extension consuming that point/version, and the RC still
      delivers v1 payloads through the adapter (reference extension's suite
      stays green with a deprecation warning).
- [ ] `carbon upgrade` preflight reports per-extension compatibility
      (compatible / compatible-with-deprecations / incompatible-with-
      available-update) before touching the database, and applies extension
      migrations after core migrations in dependency order.
- [ ] Uninstalling an extension with the default archive option renames its
      schema to `ext_removed_<camelCaseSlug>`, revokes access, and severs the
      live core FK (dropped on side tables, `ON DELETE SET NULL` on nullable
      entity references) without deleting data; a subsequent delete of a
      referenced core row leaves the archived rows intact rather than cascading
      them away; no core rows are affected by the archive itself.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Scope: this is a platform, not a feature — a serious build-out across SDK, host, contracts, CLI, and CI | High | Phase it: v1 = SDK + manifest + generated schema + hooks + isolation lint for 2–3 core modules' extension points, proven by the reference extension; workflows and corpus gate follow. `/plan` decomposes per phase. |
| Contract packages ossify core internals prematurely (whatever ships becomes semver-bound) | High | Publish contracts only for modules with a proven extension use case; keep read models as projections (not row shapes); start every contract at 0.x until the reference extension exercises it. |
| `before:` hooks in core transactions add latency and a new failure mode to hot posting paths | Med | 250ms budget + no-I/O enforcement in the SDK runtime; per-hook timing surfaced in the admin UI attributed to the extension; kill-switch: disabling an extension removes its hooks immediately. |
| Corpus gate becomes a release bottleneck (community suites red, flaky, or slow) | Med | Corpus red does not hard-block release — it forces a fix, adapter, or explicit breaking-changes entry; community suites run tiered (first-party gate, community report-only initially). |
| Scoped-role and generated-RLS mistakes could open cross-tenant access via extension tables | High | The generator is the single emitter of extension DDL (no hand SQL); conformance checks assert tenancy invariants on `ext_*` tables; the acceptance criteria include a two-company isolation test. |
| Workflow versioning/compensation semantics are subtle; wrong guarantees are worse than none | Med | Build on Inngest primitives already in production rather than a bespoke runner; `carbon ext test` must execute timeout and compensation branches, not just happy paths. |
| Coexistence confusion between `customFields` JSONB and side-table augments | Low | v1 positions them as different tools (ad-hoc per-company fields vs. packaged extensions); docs state the boundary; no forced migration (see Open Questions). |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.
>
> Autonomous run — no human was available; each question is resolved per the
> spec-writing skill's autonomous mode (codebase precedent → research
> consensus → recommended answer) and marked **Autonomous:**. These
> resolutions must be surfaced in the PR's "Assumed decisions" section for
> human review.

- [x] **Runtime placement — do extension hooks/workflows execute in-process
      with the app or in an isolated worker?** Why it matters: it sets the
      blast radius of a misbehaving extension (crash, memory, latency) and
      the cost of the v1 build. — **Autonomous:** in-process for v1.
      Codebase precedent: Inngest functions already execute in-process via
      `@carbon/jobs`, and `after:` hooks/workflows ride that path; `before:`
      hooks are budgeted (250ms, no I/O) and SDK-enforced. The manifest/
      contract design is placement-agnostic, so an isolated worker can be
      introduced later without contract changes. Out-of-process isolation in
      v1 would roughly double platform scope for a threat model (untrusted
      third-party code) that the initial first-party/reviewed corpus doesn't
      yet have.
- [x] **Which UI slots ship in v1?** Why it matters: every slot is a
      permanent compatibility surface on a core screen — too few and
      extensions can't build real UX, too many and core UI is frozen early. —
      **Autonomous:** entity detail panels, table columns, and action menus
      for the top ~10 extension-relevant entities (receipt/receipt line,
      shipment, sales order, purchase order, job/job operation, item,
      customer, supplier, quality issue), growing only by PR with a named use
      case. Research consensus: slot sprawl is how UI patching sneaks back
      in; a small, demand-driven inventory matches the "new capability = new
      extension point via PR" principle.
- [x] **What happens to the existing `customFields` JSONB feature once
      side-table augmentation ships?** Why it matters: production tables and
      live customer data are involved; a forced migration is Ask-First
      territory and a wrong story creates two competing mechanisms forever. —
      **Autonomous:** coexistence, no migration in v1. `customFields` remains
      the end-user, per-company, ad-hoc mechanism (a settings feature);
      side-table augments are the packaged-extension mechanism (a developer
      feature with types, FKs, and RLS). They serve different actors, so
      neither deprecation nor migration is forced. A future opt-in "promote
      custom field to extension field" tool is deliberately deferred —
      anything touching production data migration goes back to a human.
- [x] **Registry governance — what does a community extension need to enter
      the corpus (and thus influence release gating)?** Why it matters: the
      corpus gate's value depends on corpus quality; an unreviewed corpus
      makes releases hostage to broken third-party tests. — **Autonomous:**
      v1 corpus is first-party extensions only (always in, gating). Community
      extensions run report-only against RCs after an opt-in with a minimal
      bar: green `carbon ext test`, manifest lint, semver discipline. Full
      community governance (review process, gating status, revocation) is
      explicitly deferred to a follow-up spec once a community exists to
      govern.
- [x] **Do paid extensions integrate with the existing Stripe billing at the
      platform level in v1?** Why it matters: billing hooks shape the
      manifest (pricing metadata), the registry, and install/enable flows —
      retrofitting is expensive, but building it speculatively is scope. —
      **Autonomous:** out of scope for v1, recorded as an explicit deferral.
      No first-party extension needs it, and per `.ai/rules/billing-system.md`
      territory this crosses product-positioning questions a human must own.
      The manifest reserves an optional `pricing` block (ignored by v1
      tooling) so the registry format doesn't break when billing lands.

## Changelog

- 2026-07-12: Created from the extensibility architecture draft, restructured
  to the spec template. Autonomous run (no human available for the grill
  step): 5 open questions resolved per the spec-writing skill's autonomous
  mode and marked **Autonomous:** above — (1) in-process runtime for v1,
  (2) v1 UI slot inventory of detail panels/table columns/action menus for
  ~10 entities, (3) `customFields` coexistence with no forced migration,
  (4) first-party-only gating corpus with community report-only opt-in,
  (5) billing integration deferred with a reserved manifest `pricing` block.
  These require human review at the PR ("Assumed decisions" section).
