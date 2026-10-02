# Carbon Change Notice Operational Impact Assessment, revised implementation plan

**Spec:** `.ai/specs/2026-08-24-change-notice-operational-impact-assessment.md`

**Planning baseline:** `upstream/main` at
`5089ee75ee332ef22d74ebd8e230f4bbfb0c9221`

**Review scope:** This is the canonical product and architecture baseline. The
Slice 2A first-assessment, narrow Slice 2B existing-decision write, focused Slice 2C
existing-resolution, Slice 2D explicit provenance-reconciliation work, and Slice 2E
atomic bulk decision backend are tracked in the implementation and focused tests; the
remaining unchecked items below are still future work.

The previous plan defended the feature against arbitrary SQL written by Carbon's own
service-role/Kysely backend. Current Carbon does not use that trust model. This plan
keeps source-aware authorization for untrusted callers and removes the private database
security architecture that was built only for the withdrawn threat.

## Progress

- [x] Add the four Impact-owned tables, task origin, standard RLS, constraints, and indexes.
- [x] Add fixed target contracts, source-aware candidate reads, coverage, and snapshots.
- [x] Add the transactional decisions, provenance, reassessment history, and CAS checks (Slice 2A first assessments, the narrow Slice 2B existing-decision writes, Slice 2C existing Action Required resolution, Slice 2D explicit provenance reconciliation, and Slice 2E atomic bulk decision writes are implemented).
- [x] Add explicit authorized Slice 2D provenance reconciliation with source-aware, lifecycle-safe interval/history writes.
- [x] Integrate task origin, many-to-many links, lifecycle guards, MCP, and integrations (Slice 3 backend boundaries).
- [x] Build the document-first workspace foundation (Slice 4). It uses the source-aware candidate façade, keeps coverage failures visible, and loads linked task metadata without changing decisions. The workspace requests one bounded full candidate window rather than repeating source/persisted-state scans for each page. Legacy mixed-domain where-used context is not loaded in this implementation; the workspace shows an informational notice. Slice 4 itself was read-only; Slice 5A–5C add decision, task, and history controls, Slice 5D adds display-only filter/search, and Slice 5E adds bulk preview/commit UX.
- [x] Add Slice 5E bulk preview/commit UX. The workspace now selects eligible current-exposure rows, previews each reviewed snapshot in a bulk drawer, submits one explicit target list, and reports atomic success/conflict outcomes. The server binds each browser preview to an opaque SHA-256 source fingerprint plus per-decision revision CAS; stale or incomplete previews reject the whole transaction.
- [x] Add Slice 5D URL-backed client-side search and filtering over the authorized workspace DTO. Coverage summary remains unfiltered, document grouping remains intact, and incomplete candidate/task coverage keeps filtered empty states bounded.
- [x] Run the focused correction-pass checks: 157 focused Impact/server tests passed, touched-file `tsgo` verification passed with a temporary focused config, targeted Biome check passed, ERP build passed, `git diff --check` passed, and the read-only workspace browser smoke passed for navigation, refresh, Job/Job Material source-link navigation, context-only notice, no decision or bulk controls, no horizontal overflow, and no page errors.
- [x] Run Slice 5D checks: 209 focused Impact tests passed, ERP typecheck and build passed, Lingui extraction/compilation passed, full lint completed with only pre-existing warnings, and touched-file Biome passed.
- [x] Complete authenticated Slice 5D browser QA against seeded CN-000001, CN-000002, and CN-000003. Verified the Impact workspace renders, search narrows rows and persists through refresh, Decision and Domain filters update the URL and preserve authoritative coverage cards, complete-coverage empty state copy is shown, grouped current rows remain usable, and the browser reported no page errors. All seeded notices had complete task coverage, so the incomplete task/candidate warning path remains covered by automated tests only.
- [x] Complete the full ERP typecheck: `pnpm exec turbo run typecheck --filter=erp` passed. The full authorization, lifecycle, transaction, deletion, and twenty-scenario browser matrix remains Slice 6 work.
- [x] Run Slice 5E checks: 195 focused Impact/server/route tests passed, ERP typecheck, route typegen, and build passed, full lint completed with only pre-existing warnings, touched-file Biome checks passed, and `git diff --check` passed. Focused authenticated Slice 5E browser verification is recorded below; the exhaustive authorization, lifecycle, transaction, deletion, and twenty-scenario browser matrix remains Slice 6 work.
- [x] Complete authenticated Slice 5E browser QA against seeded CN-000001: verified independent multi-row selection, exact preview identity/current conclusions, shared conclusion options, selection persistence through search and refresh, atomic failure handling, successful two-target Action Required commit, selection clearing, success/revalidation state, no-op reporting, and lazy per-decision history. The first real commit exposed a reproducible Kysely DATE value mismatch (`dueDate must be a canonical YYYY-MM-DD date`); the minimal fix casts mutation date reads to text in `items.service.ts`, and the exact two-target commit passed on retest. PO-specific, Changed-since, and stale-preview scenarios had no safe seeded fixtures; automated coverage remains in place. Browser console/page errors were empty. The visible `Apply to 2` button path was then reverified with one bulk POST, one workspace revalidation, cleared selection, and no new history event.

## Dependencies

1. Schema/types must exist before TypeScript contracts are added.
2. Candidate contracts must exist before decision writes are implemented.
3. Decision and history writes must exist before Impact task creation can be atomic.
4. The read-only workspace is exposed only with its source coverage and authorization behavior represented; decision controls remain out of Slice 4.
5. Public decision/task enablement follows the complete test matrix, not an intermediate slice.

## 1. Planning verdict

### Exact code baseline

The trust-model review used `upstream/main` commit
`5089ee75ee332ef22d74ebd8e230f4bbfb0c9221`, dated 2026-08-22, with subject:
`fix(erp): pass STRIPE_CONNECT_ENABLED through the root loader to window.env (#1461)`.

The checked-out `HEAD` is older, but the source findings and current-code map below are
from the stated `upstream/main` baseline.

### Readiness

`READY TO IMPLEMENT WITH DOCUMENTED ASSUMPTIONS`

### Recommended architecture

1. Keep the feature in the Items module. It is a constrained union of
   `purchaseOrderLine`, `job`, and `jobMaterial`, not a generic impact registry.
2. Add four feature tables:
   `changeOrderImpactDecision`,
   `changeOrderImpactDecisionAffectedItem`,
   `changeOrderImpactDecisionActionTask`, and
   `changeOrderImpactDecisionHistory`.
3. Add only the smallest task-origin field required to keep Impact follow-up tasks
   editable after `Done`. Do not add a second task-security state.
4. Use source-aware RLS and server DTOs for Impact-owned evidence. PO targets inherit
   Purchasing read semantics. Job and Job Material targets inherit Production read
   semantics.
5. Authorize routes and supported API/MCP paths with Carbon's existing permission
   checks. Use a normal Kysely transaction for multi-row writes. Kysely/service-role is
   trusted after that boundary and still receives explicit company and parent predicates.
6. Keep ordinary Change Notice task authorization unchanged. A task link is
   Impact-owned metadata, not a global reclassification of the task.
7. Keep feature history separate from generic task audit. Parent deletion follows the
   existing Change Notice cascade/destructive-delete behavior.

### Highest risks

- A copied PO or production snapshot can leak through an Items-owned table if the
  source permission is omitted from the RLS policy or server DTO.
- Current Job and Job Material SELECT RLS is employee-role based, while ERP production
  routes use `production_view`. Impact must explicitly require the existing
  `production_view` capability at the app boundary and in its own RLS.
- Existing Change Notice task notes are edited through a direct client update in
  `ChangeNoticeActions.tsx`. Impact follow-up mutations need a guarded server route,
  but ordinary task text remains under the existing task model.
- Parent deletion intentionally removes child rows. Impact history is durable while
  the parent exists, not a permanent retention ledger.
- The generic MCP dispatcher can pass a Kysely client to service functions. New Impact
  tools must use a permission-aware adapter instead of exposing raw feature writes.

### Assumptions carried into implementation

- V1 maps `Change Notice operational-impact update` to `parts_update`, as the spec
  permits. The migration does not grant that capability to employee types.
- The app checks `purchasing_view` for PO targets and `production_view` for Job and
  Job Material targets. The new Impact RLS uses the same existing permission helpers.
- `Outside effectivity` is unavailable by default. It may be enabled only when the
  current Carbon implementation can derive a complete, authoritative,
  decision-relevant applicability proof from trusted server-side data. A client-
  supplied proof is never authoritative, and no generic effectivity evidence
  subsystem or arbitrary proof JSON is required. If no provider exists yet, this
  reason remains unavailable without blocking the other decision paths. The existing
  Slice 1 pure validator's optional proof/confirmation arguments are not the
  Slice 2 route request shape and must not make client data authoritative.
- `taskOrigin` is needed for post-`Done` lifecycle behavior. Its minimal values are
  `Template-owned`, `Manual`, and `Impact follow-up`.
- No product requirement depends on defending against arbitrary raw SQL from trusted
  Kysely or service-role code.

## 2. Carbon trust-model findings

### What the code says

| Area | Current evidence | Finding |
|---|---|---|
| Route authorization | `packages/auth/src/services/auth.server.ts:212-424`, `requirePermissions` | Session claims are checked against the active company. `bypassRls: true` is ignored as a permission predicate and only selects the service-role client for an employee after the other requested permissions pass. |
| User-scoped Supabase | `packages/auth/src/lib/supabase/client.ts:56-116`, `client.server.ts:14-36` | `getCarbon(accessToken)` and `getUserScopedClient(userId)` use a user JWT and RLS. API-key clients use the `carbon-key` header and RLS. |
| Service role | `packages/auth/src/lib/supabase/client.server.ts:10-12` | `getCarbonServiceRole()` uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS. It is an intentional server-only escape hatch, not a hostile database actor. |
| Kysely | `apps/erp/app/services/database.server.ts:7-27`, `.claude/rules/database-patterns.md:198-214` | Kysely uses the raw Postgres pool, bypasses RLS, and is used for real transactions. The documented rule is to authorize before calling it and scope every query by company. |
| RLS | `.claude/rules/conventions-database.md`, `20260228000000_rls-refactor-3.sql` | RLS protects user-scoped PostgREST access. It is not applied to Kysely or service-role connections. |
| `SECURITY INVOKER` | `20260817012947_intercompany-elimination-service-role.sql:10-25,30-37`, `20260716101500_change-orders.sql:457-479` | Invoker functions and invoker views deliberately preserve caller RLS. This is the normal choice when direct PostgREST access must remain constrained. |
| `SECURITY DEFINER` | `20260201181148_rls-refactor.sql` permission helpers, `20260812032423_job-material-self-reference-guard.sql:69-97`, `20260812002454_item-stock-quantities-incremental.sql:105-178` | Definer code exists for permission helpers and concrete internal triggers/derived-state maintenance. No current feature uses it to create a private application writer role. |
| Transactions | `items.service.ts:2752-2881`, `inventory.service.ts:1843-1967`, `packages/database/src/quality.ts:224-355`, accounting server functions | Carbon uses Kysely transactions for multi-row correctness. The transaction is the atomicity boundary, not a new authorization layer. |
| Parent deletion | `items.service.ts:5451-5477` | `deleteChangeNotice` cleans up CO-owned drafts, then deletes the parent. Action tasks and other children follow existing FK cascade behavior. No feature-specific parent-delete protocol exists. |
| Roles and grants | Repository-wide search at the stated upstream commit for `CREATE ROLE`, `NOLOGIN`, `BYPASSRLS`, and `SET ROLE` | No per-feature non-login `BYPASSRLS` writer role or equivalent private writer schema exists in the current database architecture. |
| MCP | `apps/erp/app/routes/api+/mcp+/_index.ts:69-122`, `lib/direct-executor.ts:120-272` | OAuth binds the request to a user/company and mints a user-scoped client. API-key requests use `requirePermissions`. The generic executor injects server-owned company/user values and may pass `getDatabaseClient()` to Kysely-first services. New Impact tools need an explicit feature authorization adapter. |

### What Carbon treats as the untrusted boundary

Carbon treats these as untrusted inputs:

```text
browser request
user-scoped Supabase/PostgREST request
direct PostgREST request
API-key request
OAuth/MCP request
caller-supplied ids, company ids, and payload fields
```

The request must pass the existing route or API authentication and permission path.
RLS protects user-scoped database access. API-key scope checks happen when
`requirePermissions` receives the required permission. The server, not the caller,
chooses `companyId` and `userId` for MCP execution.

### What Carbon treats as trusted

After a permission-checked route or server service boundary, Carbon treats these as
trusted application code:

```text
Kysely transactions
intentional service-role Supabase operations
edge-function and job orchestration
SECURITY DEFINER functions written for a concrete database invariant
```

That trust does not remove the need for ordinary correctness checks. The service still
checks lifecycle, source ownership, company scope, target type, and CAS state. It does
mean this feature does not need to make already-authorized backend SQL cryptographically
or database-level incapable of writing its own rows.

### Direct answers to the ten review questions

1. **Does Carbon treat Kysely/service-role code as trusted after `requirePermissions`?**
   Yes. `requirePermissions` is the application boundary for service-role/Kysely paths.
   The code must still pass explicit company and lifecycle predicates. Background jobs
   and edge functions may enter through their own trusted server boundary.
2. **Is there a per-feature non-login `BYPASSRLS` writer precedent?** No. The requested
   role and privilege pattern is absent from current migrations and source code.
3. **Is there permanent cross-domain confidentiality taint on a generic business
   record after a relationship is removed?** No. No current task or generic business
   record uses that model.
4. **Does Carbon rely on application transactions for high-consequence work?** Yes.
   Accounting posting, inventory/count writes, inspection execution, production
   operations, reorder/sort writes, and other multi-row services use Kysely or a
   purpose-built edge-function transaction.
5. **Which source permission should V1 targets inherit?** PO Line inherits
   `purchasing_view`. Job and Job Material inherit Production visibility, represented
   by `production_view` at the application and new Impact-RLS boundary. Change Notice
   access remains `parts_view`. Quality is context-only in V1 and uses `quality_view`
   when details are shown.
6. **Is `taskOrigin` still necessary?** Yes. It has one purpose: distinguish an
   Impact follow-up task that remains editable after `Done` from ordinary/template
   tasks that remain locked. It is not a confidentiality flag.
7. **Is `impactCreationDecisionId` still necessary?** No. The task link, task parent,
   decision identity, and one Kysely transaction are sufficient. The withdrawn
   anti-Kysely forgery requirement no longer needs a creation witness.
8. **Can `changeOrderActionTaskConfidentiality` be removed?** Yes. It has no current
   Carbon precedent and no remaining product purpose.
9. **Can private writer roles, schema/functions, and parent-delete machinery be
   removed?** Yes. The current architecture has no equivalent pattern. Remove them
   rather than inventing one for this feature.
10. **Does simplification leave a user-facing security requirement unsatisfied?** No,
    if Impact-owned evidence and Impact relationship metadata use source-aware access,
    writes require `parts_update` plus source read, and generic task content remains
    under existing Change Notice task permissions. Arbitrary sensitive text a user
    manually entered into a generic task is a broader task-classification problem,
    not an Impact-specific leak to solve here.

## 3. Existing Carbon precedents

| Precedent | Authorization boundary | RLS boundary | Trusted privileged write | DB structural protections | Why it applies |
|---|---|---|---|---|---|
| Intercompany elimination | `intercompany.eliminate.tsx` calls `requirePermissions({ create: "accounting", bypassRls: true })` | The RPC remains `SECURITY INVOKER`; a direct user RPC cannot write the synthetic company | The authorized route passes a service-role client and explicit `userId` to `generateEliminationEntries` | Group membership, company-group predicates, period Locked/Closed checks, pair de-duplication, and non-empty journal-line checks | Closest precedent for an authorized route handing a trusted writer explicit company/user context. It does not create a private DB role. |
| Financial posting and fixed assets | Accounting routes authorize the posting action before calling the server function | Kysely writes bypass RLS after route authorization | `accounting.ee.server.ts:102-273` writes journal, lines, dimensions, and asset state in one Kysely transaction | Journal/line FKs, account/period identities, status checks, balanced posting rules, explicit `companyId` predicates | Impact needs the same transaction and structural checks, without copying financial-specific privilege machinery. |
| Inventory adjustment | `inventory+/quantities+/$itemId.adjustment.tsx` requires `create: "inventory"`; the edge function requires inventory permission again | Edge-function reads use a user-scoped client; the Kysely posting transaction is privileged | `post-inventory-adjustment` writes ledger, cost layers, tracked state, and optional GL posting in one transaction | Quantity validation, item/company lookup, accounting-period/default-account checks, ledger and FK constraints | Shows how a privileged server operation owns a multi-row business mutation while normal auth remains at the route/function boundary. |
| Inventory count | Route authorizes inventory access; `generateInventoryCountLines` and `updateInventoryCountLine` use Kysely | Kysely bypasses RLS; service code repeats `companyId` and parent-status predicates | Snapshot, line replacement, and count timestamp commit together | Draft-only `EXISTS` guard, company predicates, grouped ledger read, FKs | This is the closest shape for Impact snapshot/provenance writes. |
| Inspection/Quality | MES disposition route requires `update: "quality"`, then re-reads state with service role | Shared `@carbon/database/quality` engine writes through Kysely | `dispositionInspection` and sample/measurement functions transact status, samples, entities, and history | `requireOpen`, source/operation identity checks, terminal-status guards, inspection/sample links, company predicates | Impact should recompute current source facts where the operation requires assessment or reassessment, and use a normal transaction. Task completion or a stale form is never enough. |
| Workflow execution | `workflows.server.ts:81-99` explicitly documents that Kysely bypasses RLS and the calling route is the authorization gate | User-facing workflow tables use standard company RLS; execution jobs use trusted server code | Trigger synchronization and scheduler wake use a Kysely transaction and company advisory lock | Company-scoped rows, parent FKs, advisory transaction lock, workflow version ownership checks | Confirms that Carbon does not build a per-feature DB role for every trusted multi-row operation. |
| Change Notice release | `$id.status.tsx` requires `update: "parts"`; `applyChangeNotice` re-reads `Implementation` and ends with a Kysely CAS | Normal route client plus selected privileged edge/service calls | Existing release orchestration activates draft methods and flips status with CAS | Change Notice status state machine, company predicates, draft ownership, FK/cascade rules | Impact must not gate or rewrite this release path. Done remains engineering release, not Impact closure. |
| Change Notice tasks | Existing task routes use `requirePermissions`, `requireChangeNoticeEditable`, and a child ownership check. `updateChangeNoticeActionOrder` uses Kysely with CN/company predicates | Current task RLS is Parts-based and is not source-domain-aware | Existing service/client paths write tasks; no private writer exists | Task parent FK, company FK, task status enum, existing lifecycle guards | Reuse the task entity. Add only task origin, guarded server paths, and the Impact link/history transaction. |
| MCP and integrations | MCP authenticates OAuth/API-key context; integration routes/webhooks authenticate their integration and company context | User-scoped/API-key clients use RLS; direct service-role/Kysely code is trusted server code | Service-role webhooks and integration services update records with explicit company IDs | Mapping uniqueness, entity identity, service-level parent checks | New Impact MCP/integration paths must call the same application service boundary, not raw tables. |
| Parent deletion | Existing Change Notice delete route/service requires Parts delete access | Parent and child tables use normal FK/RLS behavior | The service discards CO-owned drafts and deletes the parent | Existing FK `ON DELETE CASCADE`/`SET NULL`/`RESTRICT` semantics | Impact rows should follow the same parent lifecycle. No transaction-context discriminator is needed. |

### Security function conclusion

Carbon uses `SECURITY DEFINER` for concrete reasons: RLS helper functions, trigger-owned
derived state, and isolated database invariants. It uses `SECURITY INVOKER` when the
caller must retain RLS, including the current intercompany RPC. Neither pattern is a
precedent for a feature-private writer role. Impact should use ordinary RLS and
application transactions. A simple trigger is appropriate only if a concrete structural
invariant cannot be expressed with a CHECK, FK, UNIQUE constraint, or service guard.

## 4. Carbon-native security model

### Untrusted boundary

```text
browser
direct PostgREST
API key
OAuth/MCP external caller
```

These paths use Carbon's existing auth, permission, API-key scope, user-scoped client,
and RLS mechanisms. A direct PostgREST caller cannot use Impact rows to bypass the
source permission or company boundary.

### Trusted boundary

```text
permission-checked ERP/server service
Kysely transaction
deliberate service-role operation
```

These paths run after application authorization. They must validate lifecycle and
company/parent identity, but the database does not need a second privilege system to
protect the feature from the trusted caller itself.

### Source inheritance

```text
PO Impact          → Purchasing read semantics
Job Impact         → Production read semantics
Job Material Impact → Production read semantics
```

All Impact-owned source-derived evidence follows the corresponding source permission.
A Parts-only user gets a Restricted representation, not a source-bearing Impact row.

### New write capability

```text
operational-impact update
+
source-domain view
```

V1 maps operational-impact update to `parts_update` unless maintainers choose a later
narrow capability. A PO write also needs `purchasing_view`. A Job or Job Material write
also needs `production_view`. Impact never grants source update permissions.

### DB responsibilities

```text
tenant isolation
RLS for untrusted access
CHECK/UNIQUE/FK structural integrity
```

Use `companyId`, composite feature primary keys where Carbon expects them, parent FKs,
fixed target-type checks, decision identity uniqueness, status/reason checks, and
ordinary source-aware RLS. History append-only behavior is an application rule while
the parent exists. No private role, schema, trigger context, or confidentiality ledger
is required.

### Server responsibilities

```text
authorization
lifecycle
current-exposure eligibility
snapshot validation
CAS
atomicity
history
```

The server reads current source facts and derives the canonical snapshot where
required, validates the submitted revision and relevant persisted snapshot state,
checks the Change Notice state, writes the decision/task/link/history set in one
normal Kysely transaction, and supplies explicit `companyId`, `changeNoticeId`,
`targetType`, and `targetId` predicates.

## 5. Required comparison

| Area                        | Previous overbuilt plan              | Revised Carbon-native plan                        |
| --------------------------- | ------------------------------------ | ------------------------------------------------- |
| Trusted Kysely/service role | Treated as attacker                  | Trusted after route/service authorization         |
| Impact writer               | Dedicated private DB role            | Normal authorized server transaction              |
| RLS                         | Source-aware                         | Source-aware, retained                            |
| Task confidentiality ledger | Permanent taint                      | Removed                                           |
| Ordinary linked task        | Reclassified                         | Keeps existing task authorization                 |
| Impact link                 | Source-authorized                    | Source-authorized                                 |
| Parent deletion             | Private transaction context          | Existing Carbon deletion/cascade semantics        |
| Atomicity                   | Private writer/deferred anti-forgery | Kysely transaction                                |
| Task origin                 | Lifecycle + security                 | Lifecycle only                                    |
| Generic audit               | Tombstone-dependent                  | Existing task audit; Impact history kept separate |

## 6. Product-security alignment

The approved product semantics remain unchanged. This correction only clarifies four
security boundaries:

1. Impact-owned evidence and Impact relationship metadata inherit the source entity's
   read permission.
2. An ordinary linked task remains an ordinary Change Notice task. Its link does not
   taint, reclassify, or permanently hide it from the normal task UI.
3. Impact-created tasks use generic wording by default. The task origin controls
   lifecycle after `Done`, not confidentiality.
4. Impact history is separate from generic task audit. The feature does not create
   deleted-task confidentiality tombstones or a global content-classification system.

## 7. Architecture decisions

### Module placement

Keep all Change Notice and Impact logic in:

```text
apps/erp/app/modules/items/items.models.ts
apps/erp/app/modules/items/items.service.ts
apps/erp/app/modules/items/items.server.ts
apps/erp/app/modules/items/types.ts
apps/erp/app/modules/items/ui/ChangeNotice/
```

Do not create `impact.service.ts`, `impact.models.ts`, a generic target registry, or a
new permission family.

### Supported target identity

V1 target types remain:

```text
purchaseOrderLine
job
jobMaterial
```

The database identity is:

```text
(companyId, changeNoticeId, targetType, targetId)
```

`targetType` has a fixed CHECK. `targetId` remains a constrained raw source ID. The
V1 source columns `purchaseOrderLine.itemId`, `job.itemId`, and
`jobMaterial.itemId` are each one scalar reference, and `changeOrderAffectedItem`
is unique on `(changeOrderId, itemId)`, so a target has at most one current
affected-item cause. Do not add source FKs that would turn a
deleted source into a deleted decision. Existing Carbon source tables do not all
expose tenant-composite unique keys suitable for new composite Fks. The service
validates source type, source company, Change Notice company, and target parent
before a decision is created or reassessed. The interval provenance table remains
necessary for successive causes and historical traceability, not simultaneous V1
causes.

### Minimum persistence

The feature needs these tables:

```text
changeOrderImpactDecision
changeOrderImpactDecisionAffectedItem
changeOrderImpactDecisionActionTask
changeOrderImpactDecisionHistory
```

The existing task table gets one additional field:

```text
changeOrderActionTask.taskOrigin
```

Every retained field must support a visible decision, provenance/history display,
company/parent integrity, or CAS behavior. No second task-security state or database
privilege layer is part of the schema.

### Source read mapping

| Impact target | Change Notice permission | Source read permission | Current Carbon detail |
|---|---|---|---|
| PO Line | `parts_view` | `purchasing_view` | `purchaseOrderLine` SELECT RLS uses `purchasing_view`. |
| Producing Job | `parts_view` | `production_view` at the app/Impact boundary | Current base `job` SELECT RLS is employee-role based. Do not use that broader RLS as proof of product-level production visibility. |
| Job Material | `parts_view` | `production_view` at the app/Impact boundary | Current base `jobMaterial` SELECT RLS is employee-role based. The new Impact table must still require the existing Production view capability. |
| Context-only Quality | `parts_view` | `quality_view` when details are shown | No Quality assessment rows or write capability in V1. |

### Candidate reads

Use the requesting user's Supabase client wherever practical. If a set-based server
aggregation needs a privileged read, the route first authorizes the source domain and
passes explicit company/user context. The service returns Restricted or Unavailable
instead of returning a source row that the caller cannot read.

The candidate façade:

```text
getChangeNoticeImpactCandidates(client, companyId, changeNoticeId, options)
```

must:

1. Read affected Change Notice items once.
2. Deduplicate source item IDs.
3. Query PO lines, Jobs, and Job Materials in three fixed set-based batches.
4. Hydrate parent/item/method context in batches.
5. Deduplicate targets by target type and target ID.
6. Attach the one current affected-item cause when present, plus historical
   affected-item intervals.
7. Apply domain eligibility and report coverage.
8. Preserve source errors instead of converting them to empty arrays.

`getPartUsedIn()` remains unchanged for general Item Used In screens. The Change Notice
Impact candidate path must not call it once per affected item.

### Decision and history writes

Every supported mutation goes through an ERP/server service boundary, but lifecycle and
exposure checks are operation-specific. Do not implement one global Impact-editable
guard for every mutation.

```text
authorize user/company/source context
        ↓
load Change Notice
        ↓
load existing decision if any
        ↓
classify requested operation
        ↓
apply operation-specific lifecycle + exposure preconditions
        ↓
load/normalize current source evidence where required
        ↓
validate state transition, task prerequisites, and closure evidence
        ↓
CAS/revision validation
        ↓
Kysely transaction
        ↓
decision + provenance + history + links as required
```

For create, reassess, No Action, and new/reopened Action Required, require readable
Present source evidence, complete trustworthy coverage as applicable, current
provenance, Current operational exposure, and a lifecycle that allows new work.

For `Action required -> Resolved`, require an existing persisted open decision,
authorized closure evidence, terminal task prerequisites where applicable, CAS, and
company/parent validation. Current operational exposure is not universal for this
operation: Historical reference and No longer in current scope may still be resolved.
Source deleted, Restricted, and Unavailable never auto-resolve; resolution with
missing current facts requires sufficient authorized existing evidence or owning-
workflow closure evidence.

In Cancelled, new scope, new decisions, reassessment, No Action, new/reopened Action
Required, conversion/designation of ordinary tasks into Impact follow-up, and unrelated
work are denied. Cleanup may resolve an existing open Action Required decision and may
edit/link/unlink/complete existing Impact follow-up work.
A cleanup task may be created or replaced only for that existing open decision.

A transaction must include `companyId`, `changeNoticeId`, `targetType`, and `targetId`
in every relevant predicate. It must lock or compare the current decision revision and
write no history row for a no-op or failed operation. Bulk operations preflight every
selected operation using these same rules; an ineligible row or CAS conflict rejects
the bulk operation rather than producing partial success.

Likely locks are limited to the Change Notice row when lifecycle/scope ownership
must be serialized, the affected scope row when a scope mutation is in the same
transaction, the existing Impact Decision row when its revision is compared or
updated, and current persisted provenance rows during reconciliation. Re-read the
Change Notice status and parent/child ownership inside the transaction, using one
deterministic order (Change Notice, decision, affected scope row, provenance) for
paths that need all of them. This matches the existing Impact writer and affected-item removal path. Do not lock PO Lines, POs, Jobs, Job Materials, Items,
or method/evidence rows by default: Impact reads them as evidence and owns none of
those workflows. A source-row lock requires a concrete invariant, a Carbon
precedent, and proof that a transaction-consistent read plus snapshot freshness is
insufficient.

### Task integration

Reuse `changeOrderActionTask` and add the ordinary link table. One task may support many
decisions. One decision may link many tasks. Task status remains owned by the task
workflow and never becomes decision status.

Impact task creation uses one authorized Kysely transaction. In a normal lifecycle,
the operation may use an existing eligible decision or create the Action Required
decision required by the current/open decision rules:

```text
verify or create eligible decision
+ create normal Change Notice action task
+ set taskOrigin = Impact follow-up
+ insert decision/task link
+ insert Task linked history
```

While Cancelled, the transaction must not create a new decision or target. It may create
or replace a cleanup task only for an existing open Action Required decision. A failure
rolls back that transaction. This is an atomicity guarantee for the supported
application operation. It is not a promise that arbitrary raw trusted SQL cannot write
the same tables.

Existing ordinary task linking follows these rules:

- Linking a Template-owned or Manual task does not change `taskOrigin`.
- An authorized pre-`Done` designation may change an existing task to Impact follow-up
  and write the link/history rows in the same transaction.
- `Done` and Cancelled allow Impact follow-up task edits under the Impact operation
  guard. Ordinary/template tasks remain locked.
- The Impact workspace hides restricted relationship metadata. The ordinary Change
  Notice task UI continues to use Carbon's existing task permissions.
- No task title, note, link body, supplier name, PO number, quantity, Job identity, or
  other restricted source field is copied automatically into a generic Impact task.

### Audit

`changeOrderImpactDecisionHistory` is the authoritative Impact reassessment history.
It records meaningful decision, provenance, task-link, and task-origin events while the
parent Change Notice exists.

Do not register raw source-bearing Impact snapshots or rationale in the generic audit
store in V1 unless a source-aware audit projection is designed first. Generic
action-task audit remains governed by Carbon's existing task/audit behavior. The feature
does not create a tombstone to change that behavior after task deletion.

### Parent deletion

Preserve the current Change Notice delete path:

1. existing service cleanup discards CO-owned draft methods/items;
2. the authorized parent delete runs with explicit `changeNoticeId` and `companyId`;
3. normal parent FKs cascade live Impact rows and task links where configured;
4. no custom parent-cascade protocol distinguishes the cascade;
5. feature history remains while the parent exists and may be removed by the existing
   explicit parent deletion semantics.

Removing an affected item before parent deletion must end current provenance in the
feature service and preserve the historical raw source identifiers. It must not change
the decision to No Action or Resolved.

## 8. Lifecycle and mutation matrix

Carbon's current Change Notice statuses are `Draft`, `Start`, `Engineering Complete`,
`Implementation`, `Done`, and `Cancelled`.

`A` means allowed after permission, source, state, and operation-specific validation.
`D` means denied. `C` means cleanup-only behavior for an existing open Action Required
decision or existing Impact follow-up work.

| Operation | Draft | Start | Engineering Complete | Implementation | Done | Cancelled |
|---|---:|---:|---:|---:|---:|---:|
| Discover new supported Impact scope | A | A | A | A | A | D |
| Create first decision | A | A | A | A | A | D |
| Reassess existing decision | A | A | A | A | A | D |
| Set or correct to No Action | A | A | A | A | A | D |
| Set or reopen Action Required | A | A | A | A | A | D |
| Resolve existing Action Required | A | A | A | A | A | C |
| Create ordinary Template-owned/Manual task | A | A | A | A | D | D |
| Create Impact follow-up task | A | A | A | A | A | C |
| Link or unlink a task through Impact | A | A | A | A | A | C |
| Edit Impact follow-up task | A | A | A | A | A | A |
| Edit ordinary/template task | A | A | A | A | D | D |
| Designate an existing task as Impact follow-up | A | A | A | A | D | D |
| Edit engineering content | A | A | A | D | D | D |
| Change Change Notice status | Existing transition map | Existing transition map | Existing transition map | Existing transition map | D | Draft reopen only |

### Operation-specific exposure eligibility

| Operation | Required source/exposure state | Historical / no longer current | Cancelled |
|---|---|---|---|
| Discover, create first decision, reassess, set No Action, or set/reopen Action Required | Readable/Present source, complete trustworthy coverage as applicable, current provenance, and Current operational exposure | Denied | Denied |
| Direct first-time Resolved | Same current assessable exposure as first assessment, plus evidence intervention already occurred | Denied | Denied |
| Resolve existing Action Required | Existing persisted open decision, authorized closure evidence, CAS, company/parent validation, and terminal task prerequisites where applicable | Allowed with closure evidence | Cleanup-only |
| Create/replace Impact follow-up task | Current/open decision rules in normal lifecycle | Existing decision rules | Only for an existing open Action Required decision |
| Link/unlink through Impact | Existing decision/task and operation-specific relationship rules | Existing decision/history rules | Cleanup-only |
| Edit Impact follow-up task | Existing Impact follow-up task; no new scope or conclusion | Allowed | Allowed for existing cleanup |

`Source deleted`, `Restricted`, and `Unavailable` never become an automatic
conclusion. If current source facts cannot be read, resolving an existing Action
Required decision requires sufficient authorized existing evidence or owning-workflow
closure evidence; missing data does not create a new conclusion. The application
checks the same parent and task IDs inside each mutation service. A raw trusted backend
write is not a supported user path, but the plan does not add a new database mechanism
to make it impossible.

## 9. Database and migration plan

No migration is created or applied in this review. The implementation session must use
Carbon's normal migration workflow and regenerate types before typechecking.

### Migration order

1. Add `changeOrderActionTask.taskOrigin TEXT NOT NULL DEFAULT 'Manual'` with a CHECK
   for `Template-owned`, `Manual`, and `Impact follow-up`.
2. Backfill every existing task to `Manual`. Do not infer origin from `actionTypeId`,
   task name, date, or an old template-name match.
3. Create the four Impact-owned tables with Carbon IDs, audit columns, company FKs,
   composite primary keys where the table has an ID, and parent FKs.
4. Add the fixed target-type CHECK, decision identity UNIQUE constraint, status/reason
   CHECKs, CAS revision CHECK, provenance interval uniqueness, and task-link keys.
5. Add source-aware RLS policies using Carbon's existing permission helper functions.
6. Add only indexes justified by the candidate queries and link/history access paths.
7. Run `pnpm run generate:types` after the migration is applied in the implementation
   session, before any typecheck.

The migration contains only the tables, task-origin field, constraints, policies,
indexes, and parent FKs described in this plan.

### `changeOrderImpactDecision`

Required fields:

```text
id, companyId
changeNoticeId
targetType, targetId
decisionStatus
noActionReasonCode, rationale, resolutionNote
assessmentSnapshot, snapshotVersion
assessedBy, assessedAt
revision
createdBy, createdAt, updatedBy, updatedAt
```

Constraints:

- primary key `(id, companyId)`;
- `companyId` references `company` with `ON DELETE CASCADE`;
- `changeNoticeId` references `changeOrder` with the existing parent-delete behavior;
- `targetType` is limited to `purchaseOrderLine`, `job`, and `jobMaterial`;
- status and reason values use CHECK constraints;
- UNIQUE `(companyId, changeNoticeId, targetType, targetId)`;
- no source FK, so a deleted PO line, Job, or Job Material can display Source deleted;
- index by `(companyId, changeNoticeId, decisionStatus)` and target identity.

For create and reassessment operations, the service validates that the live target
exists, belongs to the active company, matches the fixed target type, and is authorized
in the source domain. Existing Action Required resolution validates the persisted
decision identity, company/parent scope, source-domain authorization, and stored
assessment state without universally requiring the live target to still exist.

### `changeOrderImpactDecisionAffectedItem`

Persist provenance only once a target has a decision. Unassessed live provenance stays
derived from current Change Notice affected items.

Required fields:

```text
id, companyId, decisionId
affectedItemId, affectedItemSourceId, affectedItemLabel
startedAt, startedBy
endedAt, endedBy, endedReason
createdBy, createdAt, updatedBy, updatedAt
```

The affected-item IDs are historical raw identifiers. Do not FK them to
`changeOrderAffectedItem`, because removing an affected item must not erase the
historical cause. For V1, each source target has at most one current cause because
its source row has one scalar `itemId` and the Change Notice prevents duplicate
`(changeOrderId, itemId)` rows. The existing partial unique index protects one open
interval per decision/affected-item pair; the service must preserve the stronger
V1 at-most-one-current-cause invariant. Keep the interval table for successive
causes and historical traceability; it is not a reason to manufacture simultaneous
V1 causes. RLS reads through the parent decision's source domain.

### `changeOrderImpactDecisionActionTask`

Required fields:

```text
decisionId, actionTaskId, companyId
createdBy, createdAt, updatedBy, updatedAt
```

Use a composite primary key `(decisionId, actionTaskId, companyId)`, decision/task FKs
where current Carbon keys support them, a reverse task index, and a service check that
the task and decision belong to the same Change Notice and company. The link table
stores relationship metadata only. It does not store task status, task content, or
confidentiality flags.

A link insert, link delete, and corresponding feature history event use one Kysely
transaction. Parent deletion follows normal FK behavior.

### `changeOrderImpactDecisionHistory`

Required fields:

```text
id, companyId, decisionId
targetType, targetId
eventType
previousStatus, newStatus
previousReasonCode, newReasonCode
previousSnapshot, newSnapshot
rationale, resolutionNote
relatedActionTaskId, relatedAffectedItemId
priorAssessmentWasChanged
createdBy, createdAt, updatedBy, updatedAt
```

The history table is append-only by application contract while the parent exists.
Related task and affected-item identifiers remain raw historical references so a task or
affected row can be deleted without making the event impossible to render to an
authorized user. For a `Provenance ended` event, `endedReason` stays on the
provenance interval; the history row stores the event explanation in its existing
`rationale` field and identifies the relationship with `relatedAffectedItemId`.
The history table has no separate `endedReason` column. Add indexes by decision and
creation time.

Do not register raw Impact history in generic audit in V1. Source-aware history reads
must use the same target-domain permission as decision reads.

### Standard RLS

Use Carbon's four named policies where the feature supports direct PostgREST access.
All SELECT policies include both `parts_view` and the target-domain view permission:

```text
parts_view AND
  (purchaseOrderLine → purchasing_view
   OR job/jobMaterial → production_view)
```

Provenance, history, and task-link SELECT policies reach the target domain through the
parent decision. They must not use a Parts-only policy because these rows contain
copied source identity and evidence.

Impact INSERT/UPDATE policies use the product write mapping, `parts_update`, plus the
same source-domain predicate. No feature has an ordinary user delete route. If a table's
write is intentionally server-only, its PostgREST write policy remains closed and the
supported Kysely service is the writer. In neither case may a Parts-only client read or
write source-bearing rows.

RLS is not the only protection. Every server mutation checks permissions, lifecycle,
source access, and `companyId`. Kysely bypasses RLS by design.

### Migration safety

- Do not backfill decisions, provenance conclusions, snapshots, or history for old
  Change Notices.
- Existing task rows become `Manual` only. This is a conservative lifecycle label,
  not a confidentiality decision.
- Do not add source FKs that destroy the `Source deleted` product state.
- Parent deletion remains explicit and destructive under existing Carbon semantics.
- If a migration needs a follow-up fix, use a new forward migration. Do not hand-edit
  generated database types.

## 10. Candidate discovery and snapshot plan

### Fixed query groups

Use three domain query groups, issued concurrently at the domain level:

1. **PO lines.** Query `purchaseOrderLine` by deduplicated item IDs and persisted target
   IDs. Hydrate parent POs, delivery facts, and item labels in batches. Use actual
   fields such as `purchaseQuantity`, `quantityReceived`, `quantityToReceive`,
   `receivedComplete`, `conversionFactor`, `requiredDate`, and `promisedDate`.
2. **Producing Jobs.** Query `job` by affected item IDs and persisted target IDs. Load
   root `jobMakeMethod` rows in one batch. Impact active statuses are `Draft`, `Planned`,
   `Ready`, `In Progress`, and `Paused`. Terminal statuses are `Completed`, `Closed`,
   and `Cancelled`.
3. **Job Materials.** Query `jobMaterial` by affected item IDs and persisted target IDs.
   Reuse the batched Job map. Use `estimatedQuantity`, `quantityIssued`, generated
   `quantityToIssue`, `methodType`, `jobOperationId`, UOM, and the two tracking flags.
   There is no `jobMaterialUsage` table.

Every query includes `companyId`. Every parent lookup includes the same company. Never
query inside a result loop.

### Pagination compatibility

The source target IDs are Carbon's generated Base58 `id()` values. SQL pages use
`ORDER BY id` plus a strict `id > cursor` predicate. In-memory merge and cursor
comparisons must preserve the ordering behavior verified against Carbon's actual
PostgreSQL and ERP runtime, so database cursor ordering and in-memory continuation
ordering remain consistent. Regression coverage must exercise mixed-case Base58
IDs across continuation pages and assert every target is returned exactly once.

### Coverage

Return one coverage record per supported domain:

```text
complete
partial
failed
restricted
```

Only complete coverage can establish Source deleted or exact counts. A failed source
read is not an empty safe result. A restricted domain returns a non-disclosing marker
and null exact counts.

### Snapshot normalization

Keep the approved versioned contracts:

```text
PO_LINE_SNAPSHOT_V1
JOB_SNAPSHOT_V1
JOB_MATERIAL_SNAPSHOT_V1
```

Use actual current Carbon columns, explicit JSON nulls, Carbon numeric precision
helpers, canonical dates, and `datetime.timestamp()` for instants. Display names,
avatars, formatted labels, and task status stay outside the snapshot. Unknown snapshot
versions or missing required source facts yield Unavailable and block assessment.

## 11. Mutation architecture

### Permission-checked route

Every ERP loader/action uses `requirePermissions`. The workspace loader requires
`view: "parts"` and derives per-domain source access from the effective user's
claims so a restricted domain can be represented without blocking the whole page.
Create, reassess, No Action, and new/reopened Action Required writes require the
operational-impact mapping plus the relevant source read capability. Resolving an
existing Action Required decision requires the operational-impact/source-domain
authorization plus sufficient authorized closure evidence; current source read is
used when required, but is not a universal resolution prerequisite. A mutation route
may require both capabilities explicitly, for example:

```text
requirePermissions(request, { update: "parts", view: sourceDomain })
```

The exact helper composition may vary by route, but it must not rely on permissive Job
RLS as a substitute for `production_view`.

The route passes the authorized `companyId` and effective `userId` to the service. The
service does not accept a caller-selected company as authority.

For `No purchasing intervention remains`, the request carries one explicit user
attestation such as `confirmNoPurchasingInterventionRemains: true` and required
rationale. Do not add four independent reviewed flags unless a concrete Carbon
source workflow proves they are needed; the UI must spell out the return,
replacement, credit, and communication work covered by the attestation.

### Decision transaction

For one decision, the service performs operation-specific validation before the write:

1. authorize the user, company, and source-domain context;
2. load the Change Notice and an existing decision if present;
3. derive the internal operation from the existing decision and requested
   conclusion/evidence; the caller does not select a public operation enum;
4. apply the lifecycle and exposure preconditions for that operation;
5. load and normalize current source evidence where required. Create, reassess, No
   Action, and new/reopened Action Required require Current operational exposure;
6. for `Action required -> Resolved`, require the existing open decision and
   sufficient authorized closure evidence, without universally requiring Current
   operational exposure;
7. validate the state transition, reason/rationale, task prerequisites, and source
   availability rules;
8. lock or compare the decision revision;
9. insert/update the decision, start/end provenance intervals, and append the required
   history event inside one Kysely transaction;
10. commit or roll back everything.

A source that is Historical or No longer in current scope cannot receive a new
conclusion or reassessment, but an existing Action Required decision may be resolved
with closure evidence. A complete, authorized exact lookup may establish `Source
deleted`; that is source-availability evidence, never `Resolved`. Source deleted,
Restricted, and Unavailable never auto-resolve; missing current facts require
sufficient authorized existing or owning-workflow closure evidence.

Bulk operations preflight every selected operation with the same operation-specific
rules and then commit all selected decisions/history rows in one Kysely transaction.
A CAS conflict or ineligible row rejects the entire bulk operation.

### Impact task transaction

`createChangeNoticeImpactTask()` is an application service boundary, not a private
Postgres writer. It takes a Kysely client and explicit context:

```text
companyId
userId
changeNoticeId
decision identity
normal task payload
```

In a normal lifecycle, it verifies the existing open decision or creates the decision
required by the same request, subject to the current/open decision rules. In Cancelled,
it may create or replace a cleanup task only for an existing open Action Required
decision; it must not create a new target or operational conclusion. It checks the
operation-specific source/lifecycle rules and writes task + link + feature history in
one transaction. It sets `taskOrigin = Impact follow-up`; the link and history rows
provide the relationship.

`linkChangeNoticeImpactTask()` and `unlinkChangeNoticeImpactTask()` use the same
transaction pattern. Unlink removes the current relationship and records `Task
unlinked`. It does not create a confidentiality state and does not alter the ordinary
task's global authorization.

### Task mutations outside Impact

Refactor Change Notice task notes, status, due date, assignment, deletion, and external
sync paths so each supported path checks the task parent and task origin. Keep template
reconciliation as a workflow operation. It must not delete any `Impact follow-up`
task during template reconciliation, whether or not that task has a template link.

MCP and integration paths must call these guarded service operations. The generic MCP
direct executor may continue to provide the shared Kysely client, but new Impact tools
must verify the effective user's required permissions and use server-owned company/user
context before calling a Kysely write.

## 12. Read paths, task content, audit, and deletion

### Source-aware Impact DTOs

The workspace and history routes return a source-safe DTO, not `select(*)` from an
Items-owned table. Without the relevant source view permission, return only:

```text
Restricted
Cannot assess
```

Do not return source target identity, quantities, snapshots, source-derived rationale,
resolution evidence, detailed Impact history, Impact decision-link metadata, or exact
restricted counts.

### Ordinary task content

`changeOrderActionTask` remains a normal Change Notice task. Its existing task RLS and
server authorization continue to govern the ordinary task UI, generic audit, and
external mapping paths. The Impact workspace must not reveal a restricted link or
relationship through an unauthorized Impact read.

Operational Impact must not automatically copy restricted source fields into task
content. A user-entered task note may still contain any text allowed by the existing
Carbon task model. V1 does not create a content-classification engine.

### Generic audit

Keep Impact feature history separate from generic audit. Do not add raw source-bearing
Impact snapshots or rationale to `audit.config.ts` in V1. Ordinary task audit remains
under existing audit permissions and retention. If a future requirement needs
source-aware task audit, it needs a separate design. This plan does not change the
existing task-audit authorization or retention behavior.

### Parent and source deletion

- Source PO/Job/Job Material deletion leaves the decision identity and feature history
  available while the Change Notice exists. A complete, authorized exact lookup may
  establish `Source deleted`, but that is source-availability evidence, not
  `Resolved`; only an explicit resolution with sufficient closure evidence can
  resolve an existing Action Required decision.
- Affected-item removal ends the one current provenance cause in a focused
  application transaction with the scope deletion where possible and preserves raw
  historical identifiers. It does not require converting the existing draft
  orchestration or best-effort cleanup into one large transaction.
- Generic item deletion currently cascades through
  `changeOrderAffectedItem.itemId ON DELETE CASCADE`, so it can remove live source
  and affected-item rows independently of Impact. Persisted Impact decisions and
  historical identity remain preserved. Before Slice 2 exits, settle generic
  deletion consistently with `Source deleted` and provenance semantics using the
  actual provenance reconciliation implementation. Prefer reconciliation through
  explicit refresh/provenance machinery unless a synchronous guard is proven
  necessary by that implementation. Do not make generic Item deletion part of the
  Impact transaction by default.
- Explicit affected-item removal remains the operation that should synchronously end
  the current provenance interval because it directly changes Change Notice scope.
- Explicit Change Notice deletion follows `deleteChangeNotice`, existing draft cleanup,
  and normal FK cascade behavior. It may remove live decisions/history/links with the
  parent. No private child-delete protocol is added.
- Generic task deletion and generic task audit keep Carbon's existing behavior. Impact
  history does not become a permanent ghost record after the parent or task is deleted.

## 13. Test matrix

### Source-derived reads

Test direct PostgREST and the server DTO path, not only React rendering:

- `parts_view` without `purchasing_view` cannot read PO Impact context, decision,
  snapshot, provenance, history, Impact link metadata, or exact restricted counts.
- `parts_view` without `production_view` cannot read Job or Job Material equivalents,
  even though current base Job RLS is employee-role based.
- A wrong-company target cannot be read or written.
- Source query failure returns Unavailable/failed coverage, never an empty safe result.
- Partial coverage never produces Source deleted or a new No Action conclusion.
- Restricted UI reveals no source identity, quantity, snapshot, rationale, resolution
  evidence, exact count, or restricted Impact link metadata.

### Writes and permissions

- Missing source view permission blocks create, reassess, No Action, new/reopened
  Action Required, and task-link writes. Existing Action Required resolution requires
  the source/Impact authorization plus sufficient authorized closure evidence; it is
  not rejected by a universal Current-exposure rule.
- Missing `parts_update` blocks Impact writes.
- API-key scopes lacking the required source or write permission receive the same denial
  or Restricted result as a session user.
- Every write and read remains company-scoped.
- Supported ERP, MCP, integration, and service-role route paths use the same source and
  lifecycle checks.

### Lifecycle

- Ordinary/template task creation and edits work before `Done` and are locked after
  `Done` or `Cancelled`.
- Done permits supported current-exposure discovery, create, reassess, resolution,
  Impact task creation, task linking/unlinking, and Impact follow-up task edits while
  engineering content remains locked.
- Create first decision, reassess, No Action, and new/reopened Action Required require
  readable Present source evidence and Current operational exposure.
- Historical and No longer in current scope targets reject new decisions, reassessment,
  No Action, and Action Required.
- An existing Action Required decision may be resolved in Historical or No longer in
  current scope with sufficient closure evidence and CAS/state/task checks.
- A direct first-time Resolved decision requires current assessable exposure and
  evidence that intervention already occurred.
- Cancelled rejects new scope, first decisions, reassessment, No Action, new/reopened
  Action Required, and unrelated Impact work, but permits cleanup for an existing open
  Action Required decision and existing Impact follow-up task.
- Cancelled cleanup may edit, assign, reschedule, update notes, complete/skip where
  normal task semantics allow, and link/unlink existing Impact follow-up work. A task
  may be created/replaced only for an existing open Action Required decision.
- Cancellation or cleanup resolution does not itself end provenance or infer a
  conclusion; provenance maintenance follows an explicit scope/source reconciliation.
- Source deleted, Restricted, and Unavailable never auto-resolve a decision; missing
  current facts require sufficient authorized existing or owning-workflow closure
  evidence.
- Impact follow-up task edits work after `Done` and during permitted Cancelled cleanup.
- Completing a task never changes the Impact decision.
- Linking an ordinary task never changes its origin or post-`Done` editability.
- Impact-created task content uses generic default wording and does not copy restricted
  source fields into title, notes, or external metadata.

### Transactions and concurrency

- Decision + provenance + history either all commit or all roll back.
- Task + link + Task linked history either all commit or all roll back.
- Link + Task unlinked history either all commit or all roll back.
- Failure injected between writes leaves no partial application rows.
- Two first assessments produce one decision through the unique key/CAS behavior.
- Two reassessors with one revision produce one success and one refresh conflict.
- Bulk preflight failure commits no selected decision/history rows.
- Repeated refresh does not duplicate provenance or history.

### Structural database checks

- Fixed target type and decision identity CHECK/UNIQUE constraints reject malformed
  rows through untrusted PostgREST.
- Parent/company FKs preserve tenant and parent integrity.
- History has no ordinary user delete operation while the parent exists.
- Ordinary RLS denies source-inaccessible Impact rows.
- No test treats raw trusted Kysely/service-role SQL as an attacker, and no test requires
  a trusted backend to be unable to forge a feature row.

### Tests removed as architectural requirements

Do not add adversarial tests for trusted-backend forgery, feature-specific database
privilege exposure, parent-cascade context spoofing, or permanent task-confidentiality
state after unlink/deletion. Those tests defended the withdrawn threat model. Trusted
server code gets correctness, company-scope, lifecycle, transaction, and regression
tests instead.

## 14. Implementation sequence

### Slice 0: persistence and standard RLS

Add task origin, the four Impact tables, fixed constraints, parent/company FKs, source-
aware RLS, and justified indexes. Backfill existing tasks to Manual. Generate database
types. Do not add a feature-specific database privilege or cascade protocol.

Exit condition: schema and generated types are coherent, direct unauthorized Impact
reads fail, and no old Change Notice receives a decision backfill.

### Slice 1: contracts and candidate reads

Add fixed target/status/reason/origin models, actual snapshot normalizers, set-based PO/
Job/Job Material candidate reads, context-only reads, source availability, and coverage.

Exit condition: source failures cannot look like empty safe coverage, and candidate reads
have no N+1 loops.

### Slice 2: decision ledger and feature history

Add decision create/reassess/resolve/correct, provenance reconciliation, CAS, history,
explicit refresh, and bulk transaction helpers. Slice 2D provides the explicit
server-authorized refresh boundary for persisted provenance. Slice 2E adds the
server-authorized raw bulk decision boundary: explicit unique targets for one Change
Notice, one complete preflight, batched authoritative reads, deterministic locks, and
one Kysely transaction. Bulk preview and commit UX remain deferred to Slice 5.

Exit condition: decision, provenance, and history writes are atomic and source-aware.

### Slice 2E verification record

- Bulk requests are strict and explicit: target identities are unique, server-derived
  operation/event/snapshot fields are rejected, and there is no arbitrary selection cap.
- Bulk authorization resolves the Change Notice gate, Items update gate, and source
  domain access once before the raw Kysely service boundary; the raw service is blocked
  from generic MCP discovery and execution.
- Preflight groups PO Lines, Jobs, and Job Materials, batches source/dependency/scope/
  decision/provenance reads at 50 IDs, locks the Change Notice and owned rows in a
  deterministic order, and applies all target plans atomically.
- Focused Vitest verification: 5 files, 171 tests passed; ERP TypeScript verification
  passed with `NODE_OPTIONS=--max-old-space-size=8192`.
- The database SQL harness passed, and a temporary Node/Vitest PostgreSQL harness
  verified mixed commit, stale preflight rollback, late apply rollback, and concurrent
  identical bulk serialization. The temporary harness was removed and its fixtures
  cleaned up. `psql` is not installed; PostgreSQL was reached through the repository's
  `pg` dependency.

### Slice 3: task origin, links, and lifecycle

Add the ordinary many-to-many link, task-origin writes, Impact task creation/link/unlink
transactions, operation-specific Done/Cancelled guards, guarded notes/assignment/due
date/status paths, and the matching MCP/integration service adapters.

Exit condition: ordinary linked tasks stay ordinary, Impact follow-up tasks remain
editable after Done, and no generic task text receives automatic restricted source
fields.

### Slice 4: read-only workspace

Build the document-first workspace, current exposure versus historical references,
context-only scope, provenance, coverage banners, freshness, and Restricted/Unavailable
representations. Expose the read-only workspace, but keep decision controls hidden until
Slice 5.

Exit condition: no source permission failure is rendered as an empty safe result.

**Implementation note:** The original Slice 1 and Slice 4 scope included context-only
source groups. The three assessment-target domains are implemented in Slice 4. Legacy
mixed-domain where-used context remains deliberately deferred because the existing
reader cannot provide independent source authorization and coverage guarantees without
expanding this slice substantially. This is a conscious scope deferral, not a change to
V1 assessment semantics.

### Slice 5: decisions and task UX

Add decision controls, reassessment/resolution forms, task creation/linking, history
view, filters/search, and bulk preview/commit. Keep ordinary task UI and Impact
relationship metadata separate. None of these controls are part of the Slice 4
read-only workspace.

Exit condition: all approved product scenarios behave correctly without source or task
permission leaks.

### Slice 6: verification and rollout

Run scoped package checks, direct PostgREST authorization tests, MCP/integration tests,
transaction failure tests, parent-delete tests, and browser verification for all twenty
approved scenarios. Enable decision/task controls and any broader context scope only after
the complete gate passes.

## 15. Risks, assumptions, and maintainer decisions

### Remaining real risks

- A bug in trusted service-role/Kysely code can bypass RLS, omit a company predicate, or
  write an incorrect row. Carbon's current architecture accepts that as trusted backend
  correctness risk. This feature must not pretend otherwise.
- A user may manually place source-sensitive facts in a generic Change Notice task. The
  existing task authorization governs that content. Operational Impact does not classify
  or rewrite arbitrary task text.
- Generic task audit may retain ordinary task content according to existing retention
  and audit permissions. Impact does not change that global behavior.
- The current base Job RLS is broader than `production_view`; the new Impact RLS and
  route checks must not copy that broad predicate.
- Parent deletion may remove feature history. That matches the current Change Notice
  destructive-delete model and must be documented in UI/verification.

### Implementation assumptions to verify

- Intended buyer/planner roles already have the permitted `parts_update` mapping plus
  the needed source view permission.
- A current authoritative effectivity proof exists before `Outside effectivity` is
  enabled.
- MCP feature tools can obtain effective user claims or use a server adapter that
  performs the same `parts_update` and source-view checks. The generic `mcp:tools`
  authentication result alone is not a substitute for the feature permission.
- Existing task note, assignment, Linear, and Jira paths can be routed through the
  operation-specific task guard without changing the external task identity.
- The latest source column names and Job status values remain those recorded in the
  candidate/snapshot section.

### Maintainer decisions only if assumptions fail

1. If `parts_update` is not an acceptable V1 operational-impact capability, stop before
   implementation and choose a narrow RBAC capability. Do not add a feature-private DB
   role as a substitute.
2. If generic audit must contain raw Impact snapshots, design a source-aware audit read
   boundary first. Do not register the tables directly in the current source-blind
   generic audit store.
3. If product owners require generic task text to inherit Purchasing/Production
   confidentiality after a link, that is a new global task information-flow feature,
   not a small Impact migration. Stop and scope it separately.

## 16. Final handoff

The corrected plan keeps the approved product model and its real security requirements:
source-derived Impact evidence follows source-domain authorization, tenant isolation
remains mandatory, Impact writes require the operational capability plus source read,
and all supported multi-row operations are transactional.

It also follows Carbon's actual architecture. User-scoped Supabase/RLS protects
untrusted access. Permission-checked server code may use Kysely or service-role
operations. CHECK, UNIQUE, FK, company predicates, lifecycle guards, CAS, and ordinary
RLS enforce the invariants that belong at those layers. Task origin controls lifecycle.
It does not become a confidentiality subsystem.

The superseded feature-specific database privilege and cross-record task-security
design is absent from the implementation slices below. Nothing in the remaining
product contract requires it.

SLICE 5E BULK UX IMPLEMENTED; SLICE 6 VERIFICATION REMAINS
