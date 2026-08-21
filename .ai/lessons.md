# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start for relevant tasks.

Format: `Context → Problem → Rule → Applies to`

---

## ioredis retryStrategy returning null kills auto-recovery

**Context:** Making the Redis client (`@carbon/kv`) resilient to outages (issue #1076).

**Problem:** A `retryStrategy` that returns `null` after N attempts (e.g. `if (times > 3) return null`) tells ioredis to **stop reconnecting permanently**. Once Redis is briefly unreachable the client gives up and every later command fails with "Connection is closed." even after Redis is healthy again — the app never recovers without a process restart. Command-level timeouts/try-catch cannot fix this; it is a connection-lifecycle setting. Unit tests with `ioredis-mock` do NOT catch it — only a real kill-and-restart test does.

**Rule:** For long-running servers, `retryStrategy` must keep reconnecting with capped backoff (`min(times * 200, 5000)`) and never return null. Bound per-command latency elsewhere (`maxRetriesPerRequest` + a timeout wrapper), not by abandoning reconnection. Verify recovery by stopping and restarting a real Redis, not just mocks.

**Applies to:** `packages/kv/src/client.ts`, `packages/kv/src/resilient.ts`, any ioredis client config.

## Permission scope renames are invisible to typecheck

**Context:** Renaming DB RLS policies (e.g., `plm_*` → `production_*`) as part of a module rename.

**Problem:** The app layer's `requirePermissions()` and `permissions.can()` calls use string literals like `"plm"`. These are invisible to TypeScript's type checker and linter — the rename passes all automated checks but 403s every route at runtime.

**Rule:** When renaming permission scopes, grep the ENTIRE codebase for all string literal references, not just the DB layer. Check `requirePermissions`, `permissions.can`, `usePermissions`, route loaders, and any conditional UI gating.

**Applies to:** Any permission or scope rename, `apps/erp/app/routes/`, `apps/erp/app/modules/`.

## Multi-tenancy: every query must scope by companyId

**Context:** Writing service functions that query the database.

**Problem:** Forgetting to include `.eq("companyId", companyId)` in a query exposes cross-tenant data. RLS provides a safety net, but defense in depth requires application-level scoping too.

**Rule:** Every database query in a service function MUST include `companyId` scoping. Never rely solely on RLS for tenant isolation — treat it as a backup, not the primary guard.

**Applies to:** All `*.service.ts` files, any Kysely or Supabase query.

## ValidatedForm needs the validator, not the raw schema

**Context:** Building forms with zod validation.

**Problem:** Passing a raw zod schema to `ValidatedForm` instead of wrapping it with `validator()` from `@carbon/form` results in silent validation failures — the form submits without client-side validation.

**Rule:** Always use `validator(schema)` from `@carbon/form`, not the raw zod schema. Validate with `validator(schema).validate(formData)`, not `schema.parse()`.

**Applies to:** All forms in `apps/erp/app/routes/`, `packages/form/`.

## Features live inside existing permission modules

**Context:** Building a new feature that belongs to an existing domain (e.g., assembly instructions within production).

**Problem:** Creating a standalone module enum value / permission family (`Assembly` module with `assembly_*` permissions) for something that is really part of an existing domain. Assembly instructions belong to **production**, governed by `production_<view|create|update|delete>`.

**Rule:** Don't invent a new module/permission family for a feature that fits an existing domain. Add a sub-link in the existing sidebar group (like Procedures) and a full-screen editor in its own route tree (`x+/assembly+/$id`, `handle.module: "production"`, mirroring `x+/procedure+/`). Pattern: list route under `x+/<module>+/<plural>.tsx`, full-screen editor in a sibling `x+/<singular>+/` tree whose `_layout.tsx` declares the parent module. Module folder = permission module = nav module.

**Applies to:** New features under `apps/erp/app/routes/x+/`, `apps/erp/app/modules/`.

## Assembly viewer camera + animation principles

**Context:** Camera transitions and part-motion animation in the assembly instruction viewer (`packages/viewer`).

**Problem:** Per-step re-zooming and pure-geometry view heuristics lose the "where are we on the model" context; small fasteners are invisible at assembly scale; sparse path sampling produced false "removable" results (washer/bolt ordering bugs).

**Rule (user directives):**
- **Constant zoom, rotate-only:** per-step camera transitions keep the standing whole-assembly distance and only rotate toward the action — never re-zoom per step or frame a single small part tightly.
- **Occlusion-aware angles:** choose view direction by scoring how many parts block the line of sight to the animated part (seated pose + travel midpoint), not by pure geometry heuristics.
- **Exaggerate small parts:** bolts/washers get display-only exaggerated travel (>=2.5x their size) so insertions read at assembly scale.
- **Manual motion editing is a 0.001% escape hatch:** keep it collapsed behind "Edit manually"; motions come from the geometry planner.
- **Planner correctness beats coverage:** cap sample spacing (2mm) rather than sample count. Threaded fasteners need a thread-depth penetration allowance along their own axis because CAD models them as interfering solid cylinders.

**Applies to:** `packages/viewer/`, geometry planner (`crates/planner`).

## Posting-group-style matrices are a rejected pattern

**Context:** Designing multi-jurisdiction tax determination; the spec anchored on the customerType × itemPostingGroup posting-group matrix as "Carbon precedent."

**Problem:** The posting-group matrix was deliberately REMOVED (`20260229000000_drop-posting-groups.sql`) because the indirection was confusing — but the 2023 creation migration still exists, so searches find it first and it masquerades as live precedent. Anchoring a new design on it resurrects a pattern the project already rejected.

**Rule:** Do not design N×M classification-matrix configuration (party-group × item-group → outcome). Prefer flat company defaults (`accountDefault`) plus direct per-entity assignment with per-child override (the Xero model). Before citing any schema "precedent," grep for a later `DROP`/rename migration.

**Applies to:** New config/settings design anywhere; accounting/tax/posting; `.ai/specs/`, `packages/database/supabase/migrations/`.

## Backdated migration timestamps break remote deploys

**Context:** CI `supabase db push --include-all` failed on all remotes with `column pi.balance does not exist` while applying `20260616061244`, which recreated the `purchaseInvoices` view.

**Problem:** A migration merged with a timestamp OLDER than already-deployed migrations gets applied out of order on remotes: the remote had already run `20260630095023` (drops `purchaseInvoice.balance`), so the backdated view recreation referenced a dropped column. Worse, the newer `20260630*` batch had forked its view body from a pre-fix definition, silently reverting the backdated migration's fix (`supplierShippingCost` multiply vs divide) — the backdated migration was both broken AND dead code.

**Rule:** Never merge a migration whose timestamp is older than the newest migration already on `main`/deployed. Before writing a view/RPC recreation, fork from the NEWEST definition of that view (grep all migrations, take the last). When rescuing a failed backdated migration, strip the superseded parts and re-land the still-wanted change in a fresh forward-dated migration; don't rename already-partially-applied files (re-applies them).

**Applies to:** `packages/database/supabase/migrations/`, `ci/src/migrations.ts`, any long-lived branch adding migrations.

## Never resolve a control account by number/name

**Context:** Posting intercompany invoices/payments needed the "Inter-Company Receivables" control account. The edge functions (`post-sales-invoice`, `post-payment`) fetched it with `.eq("number", "1130")`.

**Problem:** Account `number` and `name` are user-editable at any time. Resolving a control account by a hardcoded number silently mis-posts the moment someone renumbers/renames the account — no error, wrong GL account. It also duplicates a magic constant across posting paths that can drift.

**Rule:** Resolve internal/control accounts by **id** via a column on `accountDefault` scoped to the `companyId` (the same pattern as `receivablesAccount`/`payablesAccount`). If no default column exists, add one to `accountDefault` (+ seed it in `seed.data.ts` and `seed-company`, + one-time backfill migration resolving the seeded number → id), then read `ad.<xxx>Account`. The only legitimate uses of `.where("number"/"eq("number")` on `account` are: building the chart at seed time, and mapping **external** codes in an integration (e.g. Xero AccountCodes) — never resolving an internal control account at posting time.

**Applies to:** `packages/database/supabase/functions/post-*`, `close-job`, `issue`, anything posting to `journalLine`; `accountDefault` schema + `lib/seed.data.ts`.

## Chart-of-accounts group headers have no number — resolve parents by name/key

**Context:** `20260524143827_fixed-assets.sql` seeded a "Deferred Tax Expense" (7090) account for every existing company group, resolving its parent with `number = '7000' AND "isGroup" = true`.

**Problem:** Group header accounts in Carbon's chart carry `number = NULL` (they are identified by seed key/name, e.g. `other-expenses` / "Other Expenses") — only leaf posting accounts have numbers. The lookup silently returned NULL and the account was inserted with `parentId = NULL`, leaving it orphaned at the root of the chart for every pre-existing company. New companies were unaffected because `seed.data.ts` parents via `parentKey`. The bug is invisible in dev (fresh seeds go through `seed.data.ts`) and only shows on long-lived databases.

**Rule:** In migrations that insert `account` rows, resolve the parent group by `"isGroup" = TRUE AND name = '<Group Name>'` (optionally + class), never by number — and treat a NULL parent as an error or explicit fallback, never insert silently orphaned. `20260630093809_ar-ap-payments.sql` is the correct precedent. When a past migration did orphan accounts, ship a follow-up UPDATE re-parenting `parentId IS NULL` rows to the group `seed.data.ts` assigns (see `20260702192816`).

**Applies to:** `packages/database/supabase/migrations/` touching `account`; `packages/database/supabase/functions/lib/seed.data.ts`; anything walking the chart-of-accounts tree.

## Never fabricate a "best-effort" motion through geometry

**Context:** The assembly motion planner (`crates/planner/src`) had a tier-4 "forced removal" that gave unsolvable parts a straight-line motion through whatever blocked them, so every part animated. On the seat-rail assembly 6/30 parts got 48–647mm fly-through motions early in the sequence — the whole animation read as wrecked.

**Problem:** A fabricated path is worse than no path: it renders as a collision, erodes trust in every other step, and hides the real geometric finding (interlocked unit, embedded solid, missing mate exemption) behind a fake answer.

**Rule:** When a solver can't prove a result, emit an explicit flagged state (`motion: "none"` + `blockedBy` + warning) and give the UI a degraded-but-honest rendering (fade-in at the seated pose). Never ship a fabricated approximation of a geometric/physical claim. Same for display fallbacks: an AABB "least-blocked direction" guess may only be used where it's labeled as a guess, never silently for planner output.

**Applies to:** `crates/planner/src`, `packages/viewer` (fallback.ts, AssemblyPlayer), `generateAssemblyStepsFromPlan`.

## Penetration tolerances must stay far below sample spacing

**Context:** The planner allowed 1.5mm "thread depth" penetration along a fastener's axis versus ALL parts, with collision samples every 2.0mm, to make solid-thread models removable through their nuts.

**Problem:** Tolerance ≈ spacing means a thin blocker (1mm washer, flange, cover) can pass between samples entirely below the allowance — the part "removes" through solid metal, which scrambles the greedy disassembly order downstream. A blanket allowance also applies to parts that have nothing to do with the threads.

**Rule:** Scope allowances to the specific mating pair that justifies them (fastener ↔ its detected threaded mate, capped at the seated interference + margin), keep the global tolerance an order of magnitude below sample spacing, and locally refine sampling near any contact that approaches the tolerance.

**Applies to:** `crates/planner/src` collision sampling; any sampled sweep/clearance check.

## trimesh CollisionManager rebuilds BVHs on every single-object query

**Context:** Re-planning the 31-part seat rail took ~2 hours; the old planner took ~59s. `manager.in_collision_single(mesh, transform)` builds a fresh FCL BVH for the queried mesh on EVERY call, and the greedy loop also removed/re-added parts per attempt (another BVH rebuild each).

**Rule:** For sampled sweeps, cache the FCL BVH per mesh (`mesh_to_BVH` once, `fcl.CollisionObject` per query) and collide against `manager._manager` directly; never remove/re-add a manager object to "exclude" it — filter its contacts by name with an infinite allowance instead. Bound sampling by the AABB separation distance (beyond it, disjointness is provable).

**Applies to:** `crates/planner/src` (`_contacts_at`, `_self_exempt`), any trimesh/fcl sampling loop.

## Don't pre-sign a short-lived upload URL before a long-running operation

**Context:** `assembly-plan` pre-signed a `createSignedUploadUrl` for `plan.json`, then called the geometry `/plan` service which ran the motion planner (~3 min) and finally PUT the result to that URL. Uploads 400'd and the job stuck in `Processing` forever; the ERP UI polled "Solving motions…" indefinitely.

**Problem:** Supabase `createSignedUploadUrl` mints a **60-second** token and the SDK gives no way to extend it (it only honors `{ upsert }`; the TTL is a storage-server setting). By the time a multi-minute planner finished, the token had expired → `400 InvalidJWT "exp claim timestamp check failed"` → the service returned 502. The fast `/convert` path (~16s) never tripped it, so the pattern looked fine. Re-runs/"already exists" are a red herring — an upsert PUT to an existing object returns 200.

**Rule:** A pre-signed **upload** URL must be consumed within ~60s of minting. For any operation that can outlast that, don't hand the worker a pre-signed PUT URL — have the service **return the artifact inline** and let the worker persist it with the service-role client the moment it has the bytes (no token, no expiry). Also bound the outbound `fetch` with `AbortSignal.timeout(...)` so a hung service fails cleanly (→ `onFailure` marks the row Failed) instead of pinning it in `Processing`.

**Applies to:** `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts`, `apps/assembler/src/main.rs` (`/plan`); any Inngest task that pre-signs storage upload URLs before a slow external call.

## Direct psql DDL needs a PostgREST schema-cache reload

**Context:** Applied an unshipped migration's delta (drop `assemblyGroup`, create `assemblyUnit`) to the local DB with `psql` instead of `crbn migrate`, to avoid a full rebuild. The ERP page then hung: the `$id` loader's `Promise.all` timed out (`fetchWithRetry` TimeoutError) even on queries against unrelated tables.

**Problem:** PostgREST caches the DB schema. `crbn migrate` / `db:migrate` reload it after applying migrations; a raw `psql` DDL does not. With a stale cache, queries against the changed tables can't resolve and hang, which exhausts the connection pool and times out *other* queries too. (Confirmed after: `assemblyGroup` returned PGRST205 "Could not find the table in the schema cache".)

**Rule:** After any direct-psql schema change to a local Supabase DB, reload PostgREST — `psql -c "NOTIFY pgrst, 'reload schema';"` (or `docker restart <...>-postgrest-1`). Prefer `crbn migrate` when possible; when patching by hand (e.g. editing an unshipped migration in place), the reload is a required follow-up.

**Applies to:** any local schema change applied outside `crbn migrate`; symptom is loader/REST timeouts after a DDL patch.

## Synthetic box meshes fake huge penetration under sustained sliding contact

**Context:** Writing planner ordering tests (`test_part_with_blocked_insertion_is_not_demoted`) with raw `trimesh.creation.box` parts: a slider seated 0.05mm into a channel floor read as depth **29.8mm** against the rail at every sweep sample, so the planner declared it inseparable and rigid-merged it.

**Problem:** FCL reports per-triangle-pair local penetration. A box face is two giant triangles; two near-coplanar giant triangles overlapping 0.05mm in the normal direction report a depth spanning their tangential overlap. Real STEP models never hit this — tessellation at `linearDeflection` keeps triangles small, so local depths stay bounded by element scale. The artifact only appears in synthetic tests whose parts sustain face-on-face sliding contact; brief seated contact that separates immediately (stacked boxes lifting off) is fine.

**Rule:** In planner tests, any part that must SLIDE while touching another needs `mesh.subdivide_to_size(5.0)` on both meshes — and prefer seating the moving part against a face perpendicular to its travel (contact vanishes on the first sample) over a face parallel to it (contact persists the whole sweep). Also avoid geometry where a seated bite must scrape past an opening sill: that is a real interference, not an artifact.

**Applies to:** `crates/planner/tests` synthetic fixtures; debugging any "cannot separate / planned as one rigid unit" result on hand-built trimesh geometry.

## Ordering heuristics must be gated on a large noisy model, not just the seat rail

**Context:** The weakly-secured-last + sandwich-gasket refactor validated green on 47 unit tests and a byte-identical 31-part seat-rail baseline, then made real planning slower with worse results. A 20-line classification probe on the 118-part SA Mando & Battery Harness immediately showed why: 4 sandwich detections — ALL false positives, including a 33mm "thin" part (ratio-only thinness cap) and two 10.4mm isotropic pass-through allowances (uncapped observed depth granted as "compliant squish").

**Problem:** The seat rail is a best-case model: named fasteners, clean contacts, no ambiguous plate stacks. Proxy signals calibrated there (name-only fastener detection, contact counts, thinness ratios) explode on models with unnamed hardware, clearance fits, and interpenetrating CAD. Two failure classes: (1) a *preference* wired into the greedy removal priority is not a preference — that ranking schedules expensive removal attempts and picks flag/merge victims, so fronting hard-to-remove parts multiplies failed sweeps (slower); (2) any heuristic that grants collision allowances fails open — one false positive corrupts collision truth for every sweep it touches (worse).

**Rule:** Before shipping a planner ordering/allowance heuristic: (a) run the classification-only probe (`.ai/scratch/geometry-probe.py`) on a large noisy model (harness/BCU class) and eyeball every cohort member and every allowance value — a 10mm "squish" is a bug, not a gasket; (b) keep display preferences in the topo sort only, never in `removal_priority`; (c) cap and axis-gate anything that relaxes collision tolerance, and prefer fail-closed (reject classification) over fail-open (grant allowance) when evidence is out of range.

**Applies to:** `crates/planner/src` ordering preferences, `_sandwiched_parts`-style classifiers, any future exempt/allowance mechanism.

## Profile the planner before optimizing — the flood was pass-through, not self-collision

**Context:** Motion planning took ~3 min (seat rail) / >30 min (harness). A micro-benchmark showed a 2,000× per-sample cost for a part colliding with its own seated copy (it stays registered in the manager), so the "obvious" fix was to unregister the moving part during its own sweeps. Implemented, byte-identical output — and **zero real-model speedup** (191→211s). cProfile told the truth: 86% of total time was `_contacts_at` under `_path_blockers`, dominated by **pass-through enumeration** — sweeping a part THROUGH its blockers enumerates the blocker's full triangle-contact set (53M contact objects on a 31-part model) at every sample for the whole travel, when all `_path_blockers` needs is each blocker's identity, discovered once.

**Problem:** Micro-benchmarks measure the mechanism you built them around, not the workload. Self-collision flooding is real but self-overlap ends early in most sweeps; deep pass-throughs persist for hundreds of samples and were the actual cost. The two look identical from the outside (both are "too many contacts").

**Rule:** For planner performance work, cProfile the real model FIRST (`cProfile.run('plan_step(...)')` — 30s of setup) and read cumtime by caller before choosing a lever. The winning fix: in `_path_blockers`, once a partner is recorded as a blocker, unregister it from the broadphase for the remainder of the sweep and re-register before returning (`registerObject`/`unregisterObject` on the SAME CollisionObject rebuilds nothing — the BVH lives on the geometry). Seat rail 191–211s → 20–26s (8×), harness >30min → 9.5min, byte-identical sequences. Keep the self-unregister too (it's what makes the synthetic test suite 8× faster), but don't mistake it for the fix.

**Applies to:** `crates/planner/src` sweep functions (`_path_blockers`, `_contacts_at`, `_unregistered`); any future "collect all X along a path" collision query.

## Verify what actually rendered before root-causing a "bad motion" report

**Context:** A user reported step 4's screw+washer "colliding through the 3D MARKETING and seat rail clamp" and asked for a motion-planning refactor. A trimesh/FCL sweep of the STORED motion against the real GLB meshes showed it was collision-free against the entire model — and the only geometrically feasible insertion (the reverse sense jams the washer into the clamp bore by 3.4mm). The visible garbage came from elsewhere: a re-motion job was still running, so steps played stale/"none" motions through the collision-blind AABB display fallback, on top of 26 never-installed components being rendered solid.

**Problem:** A "the animation collides" report conflates at least four layers: the stored plan motion, the display-time fallback synthesis (`displayMotionForStep` → `synthesizeFallbackMotion`), display adjustments (`exaggerateMotion`), and the visibility model (what else is on canvas). Root-causing the planner first is attacking the strongest layer — the geometry service's motion had `verified: true` and meant it.

**Rule:** Before touching planner code for a visual-collision report: (1) check `assemblyPlanJob.status` — Queued/Processing means the user watched placeholder motions; (2) dump the step's stored `motion` from `assemblyInstructionStep` and sweep it against the GLB (the `collision` crate, or a small trimesh script; storage files live in the storage container under `/var/lib/storage/stub/stub/<bucket>/...`); (3) only if the stored motion itself collides is it a planner problem — otherwise it's fallback/visibility/display-layer work in `packages/viewer`.

**Applies to:** assembly-instruction motion bug reports; `packages/viewer/src/{motion,fallback,AssemblyPlayer}`; `crates/planner/src`.

## GLB node↔nodeId joins must be validated against graph.json bboxes

**Context:** Building BCU acceptance fixtures from the viewer GLB: nodeIds live in glTF node `extras` which trimesh drops, so the join went through world-transform matching. The geometry service bakes vertices in world space with identity node transforms — every node "matched" position (0,0,0) and the assignment silently scrambled 431 parts. The resulting degree/volume table looked plausible ("Seal Electronics Box, degree 19, 742cm³") and drove two wrong fix iterations before the graph.json bboxes exposed it.

**Problem:** A shuffled mesh↔name assignment still produces plausible-looking planner output — garbage in, plausible garbage out. Name-prefix or transform heuristics have no error signal of their own.

**Rule:** When joining GLB scene nodes to graph.json nodeIds, match on world BBOX against graph.json's per-leaf bbox (authoritative, written by the same converter) and assert coverage (all nodes matched, max error < 1mm) before trusting any downstream analysis. `/tmp`-fixture recipe: parse the GLB JSON chunk for extras + walk scenes for world matrices, then bbox-match to trimesh geometry.

**Applies to:** acceptance/repro scripts over viewer GLBs; any offline analysis pairing `graph.json` with `model.glb`.

## Name-only fastener classification: "pin" and spec suffixes mark structure as hardware

**Context:** The SA BCU's enclosure is named "Electronics Box - 36 Pin" (a connector pin COUNT). The fastener name regex matched `\bpin\b`, classifying the box as hardware: removal priority fronted it (fasteners first → expensive failed sweeps → flagged early), base candidacy excluded it, and the assembly sequence anchored on a gasket. One word in a part name inverted the entire build order.

**Problem:** Fastener detection is name-only; real CAD names carry fastener-ish tokens in structural parts (pin counts, "M8 slot pattern" spec suffixes). A false positive is fail-open: it changes scheduling, exemptions, and base selection everywhere at once.

**Rule:** Never classify on ambiguous single tokens — "pin" is out (dowel pins still match via "dowel"). Back the name test with physical sanity in `_classify_fasteners`: a name-matched part spanning more than `max(100mm, 0.35 × assembly diagonal)` keeps its structural role. When ordering goes absurd on a new model, print the `fasteners` cohort first — one misclassified structural part explains a scrambled sequence.

**Applies to:** `crates/planner/src` (`FASTENER_NAME_RE`, `_classify_fasteners`, `removal_priority`, `_reselect_base`); future classification heuristics.

## Client-side entity caches must be company-keyed in a multi-tenant app

**Context:** A prod company export failed its closure guard: a `salesOrder` (and its `opportunity`) in one company referenced another company's customer. Root cause chain: `RealtimeDataProvider` (ERP + MES) cached the customer/item/supplier/people lists in IndexedDB under **global** keys (`"customers"`), and company switching is a client-side navigation — so after a switch, the previous company's cached list could hydrate the pickers before the properly-scoped server fetch landed. Nothing downstream caught the bad pick: zod validated `customerId` as a bare string, services inserted it blindly, RLS only checks the row's own `companyId`, and the FK was single-column (`customerId → customer(id)`).

**Problem:** Any client cache (IndexedDB/localforage, localStorage, nanostores hydrated from them) that isn't keyed by `companyId` becomes a cross-tenant leak the moment a multi-company user switches companies without a full reload. Multi-company users legitimately pass RLS for both companies, so no server layer notices.

**Rule:** (1) Key every persisted client cache entry by company (`customers:${companyId}`) and guard async hydration callbacks against mid-flight company switches. (2) Tenant-scoped references between tables should be composite FKs `(refId, companyId) → parent(id, companyId)` so the DB rejects cross-company refs from every write path (see `20260703143904_composite-tenant-fks.sql`, which converts customer/supplier refs introspectively and tolerates pre-existing bad rows via NOT VALID + warning).

**Applies to:** `apps/{erp,mes}/app/components/RealtimeDataProvider.tsx`, `apps/erp/app/stores/*`, any new client-side cache; migrations adding FKs to company-scoped parents.

## Never feed a nullable user id into a NOT NULL audit column from a DB function

**Context:** A live demo failed to record production quantities, backflush materials, or complete the job. `sync_update_job_operation_quantities` auto-flipped the operation to `Done` without stamping `updatedBy`; `sync_finish_job_operation` then passed `p_new->>'updatedBy'` (NULL) as `p_user_id` into `complete_job_to_inventory`, whose `itemLedger` insert violated `createdBy NOT NULL` (23502) and rolled back the entire cascade. A sweep found the same latent bug in `sync_purchase_invoice_line_price_change` (payload `updatedBy` → NOT NULL `purchaseInvoicePriceChange.updatedBy`) — right next to a migration that had fixed the adjacent trigger for exactly this reason.

**Problem:** `updatedBy` is nullable on every table, and trigger/interceptor UPDATEs don't go through the app layer that normally stamps it. So `p_new->>'updatedBy'`, `NEW."updatedBy"`, and `p_user_id DEFAULT NULL` params are all NULL-able user sources; writing them into a NOT NULL `createdBy`/`updatedBy`/`postedBy` makes the whole transaction (including the user's original write) roll back with 23502. The failure is invisible in testing whenever the row happens to have been user-updated before.

**Rule:** In SQL functions: (1) any UPDATE issued by a trigger/interceptor that other interceptors may react to must stamp `"updatedBy"` (from the payload's `createdBy`/`updatedBy`) and `"updatedAt"`; (2) never write a payload user field into a NOT NULL column without a fallback — `COALESCE(p_new->>'updatedBy', p_new->>'createdBy')` (`createdBy` is NOT NULL on source tables); (3) functions taking `p_user_id` that write audit columns must not default it to NULL, or must guard right after `BEGIN` with a fallback to the entity's `createdBy` (see `20260706182830_fix-null-user-audit-columns.sql`). When forking a large function to add such a guard, extract the newest body verbatim (sed) and diff-verify instead of retyping.

**Applies to:** `packages/database/supabase/migrations/` — all `sync_*` interceptors and any PL/pgSQL function writing `createdBy`/`updatedBy`/`postedBy`; reviews of new event-system interceptors.

## A LANGUAGE sql set-returning function's internal ORDER BY is not guaranteed through PostgREST

**Context:** `get_available_tracked_entities` (a `LANGUAGE sql STABLE` set-returning function) was extended with a `p_sort_method` param and a CASE-based `ORDER BY` (FEFO/FIFO/LIFO) to power an on-the-fly picking suggestion. FEFO worked, but calling the RPC for FIFO returned rows in the wrong order — its only effective sort key was the trailing `te."createdAt" ASC`, which came back unordered. Adding an explicit outer `ORDER BY "createdAt"` at the call site fixed it, proving the function's internal order was being dropped.

**Problem:** The Postgres planner **inlines** simple `LANGUAGE sql` functions into the calling query; when the caller (here, PostgREST via `client.rpc(...)`) supplies no outer `ORDER BY`, the inlined subquery's `ORDER BY` can be optimized away. Ordering that leads with a real indexed/leading column (expiration for FEFO) may survive by luck; ordering whose only key is a trailing column silently does not. Unit tests and typecheck can't catch this — only real-data querying does.

**Rule:** Do not rely on a `LANGUAGE sql` set-returning function's internal `ORDER BY` to reach the app. Either (a) sort authoritatively in the app after the RPC returns (return the sort columns and order in TS — see `apps/mes/app/services/allocation.ts` `sortLotsByPickMethod`, applied in `getSuggestedAllocationForMaterial`), or (b) if ordering must live in SQL, use `LANGUAGE plpgsql` with `RETURN QUERY ... ORDER BY` (plpgsql is never inlined). Always verify RPC ordering against seeded real data, not just unit tests.

**Applies to:** `packages/database/supabase/migrations/` set-returning `LANGUAGE sql` functions consumed via `client.rpc(...)`; any app code that greedy-fills / picks "the first row" from an RPC result.

## Tracked consumption/split must book against the entity's ACTUAL bin, not an arbitrary ledger row

**Context:** Building "return unused picks at job complete" surfaced a pre-existing bug in the `issue` edge function (`trackedEntitiesToOperation`). Consuming a batch that had been picked to a lineside shelf booked the Consumption + split `itemLedger` rows against `itemLedgers.find(il => il.trackedEntityId === id)?.storageUnitId` — the FIRST row for the entity in a `createdBy`-ordered list, i.e. an arbitrary bin. A picked entity has ledger rows in BOTH its warehouse source and its lineside bin, so consumption landed on the warehouse bin, leaving the entity at −N on-hand in one bin / +N in another: a per-bin-negative, internally inconsistent ledger, and the un-consumed remainder (a split entity) stranded on the wrong bin.

**Problem:** For a tracked entity that has moved between bins (pick/transfer), "which bin holds the stock" is NOT the first ledger row — it's the bin whose net on-hand is positive. Picking any row's `storageUnitId` silently misplaces consumption and breaks any downstream feature that reasons about physical location (e.g. returning lineside remainder to source).

**Rule:** When booking a consumption/split/movement ledger row for a tracked entity, resolve the storage unit from **net on-hand per bin** (the bin with the highest positive net), never `.find(...)?.storageUnitId` over an unordered/`createdBy`-ordered list. See `resolveTrackedEntityBin` (`packages/database/supabase/functions/issue/resolve-tracked-entity-bin.ts`, pure + `deno test`-covered). Scope such a fix to the path you can verify — the same `.find` pattern exists in other cases (e.g. `unconsumeTrackedEntities`); don't blanket-replace untested paths.

**Applies to:** `packages/database/supabase/functions/issue/index.ts` and any edge function inserting `itemLedger` rows for a tracked entity that may hold stock in multiple bins.

## Biome does not apply 3rd-level nested configs — enforce Deno via an override

**Context:** Bringing Supabase edge functions (`packages/database/supabase/functions/**`, Deno) into Biome's lint surface for the new `noConsole` rule. These files sit outside the linted globs (`apps/*/app/**`, `packages/*/src/**`) and were never Biome-formatted.

**Problem:** A dedicated nested `functions/biome.jsonc` (root:false, formatter off, noConsole only) is silently ignored. Biome applies the depth-1 nested config (`packages/biome.jsonc`) for the whole `packages/` subtree; a depth-2 nested config under it never governs — the `format` diagnostic keeps appearing and `formatter.enabled:false` has no effect. Letting `packages/biome.jsonc` (which `extends "//"`) govern the Deno files directly produces ~270 CI-failing errors (Deno globals → `noUndeclaredVariables`, `useImportType`, `organizeImports`, formatting) on never-linted code.

**Rule:** Do not rely on 3-level Biome config nesting. Add the target path to the depth-1 config's `files.includes`, then scope an `overrides` entry there (glob relative to that config) that turns off `formatter`/`assist` and the Node-oriented error rules (`correctness.noUndeclaredVariables`, `noUnusedVariables`, `style.useImportType`) while inheriting the one rule you want (`noConsole` as a warning). Verify with `pnpm exec biome check --reporter=summary <dir>` expecting 0 errors. See `packages/biome.jsonc`.

**Applies to:** `biome.jsonc` / `packages/biome.jsonc` rule scoping; any attempt to lint Deno edge functions or other non-`src/` trees.

## React Router v7 middleware `next()` never rejects on thrown Responses/errors

**Context:** Writing `requestIdMiddleware` (`@carbon/logger`) that sets an `x-request-id` header on the response after `await next()`, and worrying that thrown redirects/`data()` from loaders/actions would skip the header.

**Problem:** It is easy to assume `next()` propagates the thrown redirect/error (route handlers DO `throw redirect(...)`), which would mean post-`next()` response mutation is skipped on those paths. That assumption is wrong and leads to defensive try/catch that isn't needed.

**Rule:** In RR v7 middleware (`callRouteMiddleware`, react-router dist), `next()` wraps the downstream chain in try/catch and **resolves** with `errorHandler(error)`'s Response — it only rejects if `request.signal.aborted`. So mutating headers on the resolved response after `await next()` correctly covers redirects and error (500) responses; only aborted requests skip it, which is fine (client is gone). Register the middleware first so downstream runs inside its `withContext`/ALS scope.

**Applies to:** any RR v7 `middleware`/`clientMiddleware` that reads or mutates the response after `next()`; `packages/logger/src/middleware.server.ts`, `packages/auth/src/middleware/*`.

## Composite (`id, companyId`) FKs break PostgREST `alias:column(...)` embeds

**Context:** RFQ supplier linking silently failed — `getPurchasingRFQSuppliersWithLinks` / `getPurchasingRFQSuppliers` (`purchasing.service.ts`) returned an empty `suppliers` array even though the `purchasingRfqSupplier` row existed, so the Properties multiselect never showed linked suppliers and an optimistic add reverted on revalidation.

**Problem:** The embed `.select("*, supplier:supplierId(id, name)")` uses the `alias:foreignKeyColumn(...)` disambiguation form. That only resolves when `supplierId` is a **single-column** FK. Multi-tenant FKs here are **composite** — `purchasingRfqSupplier_supplierId_fkey FOREIGN KEY ("supplierId","companyId") REFERENCES supplier(id,"companyId")` — so PostgREST returns `PGRST200: Could not find a relationship ... 'supplierId' ... Perhaps you meant 'supplier'`. The whole query errors, `data` is null. Loaders that do `result.data?.map(...) ?? []` (and never check `result.error`) swallow it as "no rows". Same bug hit the nested `supplier:supplierId (*)` inside `supplierQuote:supplierQuoteId(*, ...)` for linked-quote reads.

**Rule:** For a composite-FK relationship, embed by **target table name** — `.select("*, supplier(id, name)")` (or the explicit constraint `supplier:supplier!purchasingRfqSupplier_supplierId_fkey(...)`), never `alias:fkColumn(...)`. Verify a PostgREST embed against the running REST API (`/rest/v1/<table>?select=...` with the service-role key) — PGRST200 is a schema-cache error returned even on empty tables. And when a loader powers UI state, check `.error`, don't `?? []` a failed query into silent emptiness.

**Applies to:** any supabase-js embed on a join table with a composite `(entityId, companyId)` FK — `purchasingRfqSupplier`, `supplierQuote.supplierId`, and siblings; `apps/erp/app/modules/purchasing/purchasing.service.ts`.

## Dual-major deps of workspace source packages crash the SSR bundle when the shared dep is externalized

**Context:** Merging assembly instructions (#1075) added `@carbon/viewer` (a source-only workspace package) with `@react-three/fiber@8`, whose ESM dist does `import create from 'zustand'` against its own nested zustand v3. The app + `@react-three/drei` use the catalog zustand v5, which removed the default export.

**Problem:** Production (app.carbon.ms) 500'd on every request while builds stayed green. Vite/rolldown inlines deps of linked workspace packages into the SSR bundle but externalizes packages resolvable from the app root **by package name**, merging fiber's v3 default import with v5 named imports into one `import ste,{create,...}from"zustand"` in `build/server/index.js`. Node resolves that to v5 at runtime → `SyntaxError: The requested module 'zustand' does not provide an export named 'default'` at `ModuleJob._instantiate` — before any code runs, so the error never reaches error reporting, dev SSR never reproduces it (per-importer resolution), and Vercel previews show READY (crash is invocation-time). The runtime log dumps a random window of the minified bundle (logtape's timezone formatter), which reads like an Intl/timezone error — red herring.

**Rule:** When a dep of a workspace source package pins a different major of a package the app also depends on, add that package to `ssr.noExternal` in the consuming apps' `vite.config.ts` so each importer keeps its own inlined copy. Verify with a build + `grep -E "from *[\"']zustand" build/server/**` (expect no bare imports) and `node --input-type=module -e "await import('.../build/server/index.js')"` — reaching an env-var error proves linking succeeded. For any all-requests-500 Vercel incident with a minified source dump, read the **last** lines for the real error and check `node:internal/modules/esm/module_job` in the stack before believing anything the dumped source suggests.

**Applies to:** `apps/erp/vite.config.ts`, `apps/mes/vite.config.ts` `ssr.noExternal`; any new dep of `@carbon/viewer` or other source-only workspace packages (`@carbon/form`, `@carbon/onboarding`, ...) that pins an older major of a shared package.

## `@ts-expect-error TS2589` on Supabase joined-selects is fragile — flips "used/unused" as files are added

**Context:** The `$itemId.purchasing.$supplierPartId.delete.tsx` routes (material / tool / consumable / part / …) each do `client.from("supplierPart").select("id, supplierId, supplier:supplierId(name)")`. Some carried `// @ts-expect-error TS2589 — … type instantiation too deep`. Adding an unrelated new route file (`periods.generate.tsx`) flipped which file the checker reported: `material` went from TS2578 (unused directive) to clean, `tool` went from clean to TS2589 — a whack-a-mole that broke `erp` typecheck without touching those files.

**Problem:** TS2589 ("type instantiation is excessively deep") on PostgREST joined-select types is **order/threshold dependent** — it surfaces at whichever file crosses a cumulative-depth limit during a given check pass, so which file errors changes as files are added/removed elsewhere. `@ts-expect-error` *requires* an error on the next line, so a directive that was "used" becomes an "unused directive" (TS2578) the moment the trigger moves — and the newly-triggering file now lacks a directive (TS2589). Swapping directives just moves the problem.

**Rule:** Don't manage TS2589 on Supabase joined-selects with `@ts-expect-error` — it *requires* an error, so it flips to TS2578 the moment the trigger moves to another file. Use `@ts-ignore` instead (the codebase's choice on the `supplierPart` delete routes): it suppresses the error when it fires and stays green when it doesn't, and it preserves the inferred `result` type. A localized `(client as any)` cast is the heavier alternative — it removes the file from the cumulative-depth pool entirely but drops the result's type; prefer `@ts-ignore` unless you specifically need to break the inference chain.

**Applies to:** the `supplierPart` joined-select delete routes and any similar `alias:fkColumn(...)` embed that trips TS2589; `apps/erp/app/routes/x+/{material,tool,consumable,part}+/...delete.tsx`.

## Changing `seed.data.ts` only reaches NEW companies — existing companies need a reconciling migration

**Context:** The period-close checklist changed (dropped "Close the period", reclassified two Auto/Manual tasks to Action). Those edits went into `packages/database/supabase/functions/lib/seed.data.ts` (+ `seed-company` / `seed-dev`), which only run on **company creation**. Existing companies — seeded by the original migration's `INSERT … FROM company` — kept the old task set, so the fixes never reached them.

**Problem:** Seed data (`seed.data.ts` + `seed-company`) and migration-time seeds (`INSERT … FROM company`) are two different populate paths. Editing the former fixes new companies; existing companies are frozen at whatever the migration inserted. The two silently drift.

**Rule:** When you change seeded per-company template rows (`periodCloseTaskDefinition`, `paymentTerm`, `accountDefault`, …) in `seed.data.ts`, also write an idempotent **reconciling migration** for existing companies (`INSERT … FROM company … ON CONFLICT DO UPDATE`, plus deletes for removed rows), guarded on the `system` user for the `createdBy` FK. Validate it in a rolled-back psql txn that simulates the old state. Deleting instance rows to force re-instantiation is fine when no real data depends on them (confirm first).

**Applies to:** any change to `packages/database/supabase/functions/lib/seed.data.ts` per-company templates; `seed-company/index.ts`, `seed-dev.ts`.

## meshopt vertex codec requires a stride that is a multiple of 4 — i16 VEC3 normals break it

**Context:** `crates/optimize` quantizes normals to i16 (SHORT, normalized) to shrink the optimised GLB, encoding each attribute as its own `EXT_meshopt_compression` vertex buffer. An i16 VEC3 normal is 6 bytes, so the normal view was emitted with `byteStride: 6`. The GLB reparsed and round-tripped fine through the Rust `meshopt` decoder, and all crate tests passed.

**Problem:** `meshopt_encodeVertexBuffer`/`decodeVertexBuffer` require the vertex size be a **multiple of 4** (`assert(vertex_size % 4 == 0)`); the Rust binding doesn't assert in release, so it emitted a 6-byte-stride stream that only its own decoder round-trips. The spec-compliant JS `MeshoptDecoder` (three.js / `three-stdlib`) rejects it with `Malformed buffer data: -2`, so the viewer showed a black screen — and because the failure is inside the decoder, no obvious app-level error surfaced. Positions (stride 12) and indices were fine; only the 6-byte normal stream broke.

**Rule:** Any attribute encoded as a meshopt vertex buffer must have a stride divisible by 4. Pad i16 VEC3 normals to i16 VEC4 (8 bytes, 4th lane `0`) — the accessor stays VEC3 (reads x,y,z; the 8-byte stride skips the pad) and the constant pad lane compresses to ~nothing. Never trust "reparses + Rust-decoder round-trips" as proof a meshopt GLB is valid; validate against the spec JS decoder (`GLTFLoader.setMeshoptDecoder`). The regression test `quantized_normals_keep_meshopt_stride_multiple_of_four` asserts every `ATTRIBUTES` view stride is `% 4 == 0`.

**Applies to:** `crates/optimize/src/lib.rs` (`ViewData`, the meshopt assemble path); any new quantized attribute type added to the optimiser; the `@carbon/viewer` `useAssembly` loader that consumes these GLBs.

## Large text `.gltf` with an embedded base64 buffer can't be serde-parsed bounded — stream it into a GLB

**Context:** The assembler optimises uploaded models. Text `.gltf` (the Onshape export shape) carries its single geometry buffer as a base64 `data:` URI. `optimize_gltf` did `serde_json::from_slice(gltf_bytes)` then base64-decoded the URI. GLB (`optimize_glb`) was already bounded — its BIN chunk is a `&[u8]` slice into the mmap.

**Problem:** For a 1.73 GB `.gltf`, serde materialises the base64 as an owned ~1.73 GB `String`, then base64-decode allocates ~1.3 GB more — both live at once → ~3 GB peak. mmap doesn't help because serde copies the string out of the mapped bytes. The assembler failed with "source file exceeds the size limit" (a separate cap) and, once that was lifted, was on track to OOM on parse.

**Rule:** Don't serde-parse a glTF whose buffer is a giant base64 data URI. Repack `.gltf` → `.glb` first with a **streaming** base64 decode: walk the JSON with `struson` (`transfer_to` copies the small structural fields verbatim, dropping the buffer's `uri`), then `next_string_reader()` the base64 value through `base64::read::DecoderReader` straight into the GLB BIN chunk on disk. Then mmap the `.glb` and use the already-bounded `optimize_glb` path — geometry never heaps. Verify decoded length == the buffer's declared `byteLength` (fail loud, never emit a corrupt GLB). `crates/optimize::gltf_to_glb` + `apps/assembler` `load_source` (`Format::Gltf` → repacked temp `.glb` → `Src::MappedTemp`).

**Applies to:** `crates/optimize/src/lib.rs` (`gltf_to_glb`; `optimize_gltf` was removed), `apps/assembler/src/actions/optimize.rs` (`load_source`, `run_optimize` — every source is GLB now); any new large-text-JSON asset with an embedded base64 blob.
## Raw-SQL item fixtures break type-specific UI — Material items need a companion `material` row keyed by readableId

**Context:** Posting-flow verification created a type-`Material` item (RM-STEEL) with a raw `INSERT INTO "item"`. Interceptors auto-created `itemCost`/`itemReplenishment`/etc., so purchasing and posting worked. Later, selecting that material on a part's BOM (`/x/part/{id}/details?materialId=…`) crashed the whole page with "Not Found".

**Problem:** Type-specific detail RPCs join companion tables the interceptors do NOT create: `get_material_details` requires a `material` row joined via `material."id" = item."readableId"` (readableId, not item id — all revisions share one taxonomy row). The properties route throws `404` when the RPC returns nothing, and a fetcher 404 bubbles to the route error boundary, taking down the entire details page.

**Rule:** When creating item fixtures via SQL, create the type's companion row too (`material` keyed by `readableId` for Materials; check the `get_{type}_details` RPC joins for the type). Prefer creating fixtures through the UI or service functions when the item will be used in UI flows, not just ledger posting.

**Applies to:** any psql/SQL test-fixture item creation; `get_material_details` / `get_part_details` / `get_tool_details` consumers; `apps/erp/app/routes/x+/items+/$itemId.properties.tsx`.

## Journal debit/credit is derived from account class + amount sign, not the raw sign

**Context:** Seeding a Cash sale as a journal via SQL, I used Cash (Asset) `amount = +1000` and Sales (Revenue) `amount = -1000`, assuming `+ = debit, - = credit` (which the `journal` AGENTS.md states for the *stored* value). The `journalEntries` view then reported the entry as `totalDebits = 2000, totalCredits = 0` — unbalanced — and the period-close "Trial balance in balance" auto-check (`tb-balanced`) refused the close.

**Problem:** `journalEntries.totalDebits`/`totalCredits` are computed from **account class AND amount sign**: Asset/Expense `amount>0` OR Liability/Equity/Revenue `amount<0` → debit; the mirror → credit. So a *positive* amount on a Revenue account is a **credit**, not a debit. A correctly-balanced sale is Cash (Asset) `+1000` and Sales (Revenue) `+1000` — both positive. The raw `SUM(amount)` the balance RPCs use is a separate, class-agnostic signed sum; don't conflate the two.

**Rule:** When hand-seeding `journalLine` rows, set the sign to move the account toward its natural balance: `+` increases an Asset/Expense (debit) and increases a Liability/Equity/Revenue (credit). Verify against the `journalEntries` view (`totalDebits == totalCredits` per `journalEntryId`) before relying on the data — an unbalanced entry silently blocks period close. Posted `journal`/`journalLine` rows are immutable (`journal_posted_immutable` / `journalLine_posted_immutable`); to correct seeded mistakes you must disable those triggers on the local DB (superuser), never in a migration.

**Applies to:** any SQL journal fixtures; the `journalEntries` view; the `tb-balanced` close check in `computePeriodReadiness` (`accounting.ee.service.ts`).

## A period snapshot written at close races Locked-period postings unless the posting guard locks the period row

**Context:** `closeAccountingPeriod` writes the `accountingPeriodBalance` snapshot inside its transaction, after flipping the period to `Closed`. `check_accounting_period_open` only *rejects* postings when a period is already `Closed`; a `Locked` period still accepts them (Locked is a soft freeze for adjustments). A period only becomes Closed on COMMIT.

**Problem:** In the window between the close txn's snapshot `SELECT` and its COMMIT, a concurrent posting reads the period as still-Locked (the flip is uncommitted under READ COMMITTED), is allowed, and commits a line with `postingDate <= endDate` that the snapshot never captured. The read path's delta only adds `postingDate > endDate`, so that line is silently dropped from the optimized balance until reopen+reclose — a wrong financial figure with no error.

**Rule:** When a cache/snapshot is written inside a state-flip transaction and a concurrent writer keys off the *committed* state, make the writer take a lock that conflicts with the flip. Here: the posting guard reads the target `accountingPeriod` row `FOR SHARE` (migration `20260713235930`), which blocks behind the close's row lock — postings before the flip commit first (and land in the snapshot); postings after block, then see `Closed` and are rejected. `FOR SHARE` is shared, so normal concurrent postings don't block each other; only an in-flight close serializes them. Verify with two psql sessions + `lock_timeout`.

**Applies to:** `check_accounting_period_open`; `snapshotAccountingPeriodBalances` / `accountingPeriodBalance`; any close/snapshot-on-commit pattern.

## Inline-editable table cells commit on blur — the container must own navigation keys in the capture phase

**Context:** Inventory count table (PR #1135 follow-up): typed Counted Qty values were lost on Tab/Enter (only click-away saved), Enter never navigated, arrows stepped the number instead of moving the selection, and keyboard nav went dead after a commit.

**Problem:** Editable cells (`~/components/Editable/*`) persist via the input's native `onBlur`, but three things prevent that blur from ever firing on keyboard navigation: (1) the Table's key handler `preventDefault()`s Tab/Enter, so the browser never moves focus; (2) React unmounts the still-focused input when the selection moves, and browsers fire no blur on a removed element; (3) react-aria's NumberField swallows Enter entirely (`onKeyDownEnter` commits internally without `continuePropagation()`) and consumes ArrowUp/Down as spinbutton steps, so a bubble-phase table handler never sees those keys. Blurring at the input level without navigating drops `document.activeElement` to `body`, after which the table wrapper hears no further keys.

**Rule:** The table container owns the Excel keyboard model: attach the handler with `onKeyDownCapture` (so it beats react-aria to Enter/arrows), `stopPropagation()` for handled keys while editing, blur `document.activeElement` to commit *before* `setSelectedCell`, and let the roving-tabindex cell ref (`useMovingCellRef`) refocus the newly selected cell. Skip events targeting portaled overlays (`[data-radix-popper-content-wrapper]`, `[role=menu|listbox|dialog]`) — those own their keys. Editors must keep blur as their *single* commit path (no keydown commits — they double-fire the mutation, as `EditableText` did in Grid).

**Applies to:** `apps/erp/app/components/Table/Table.tsx`, `apps/erp/app/components/Grid/Grid.tsx`, `apps/erp/app/components/Editable/*`, any future inline-editable cell editor.

## Seeding useState from a prop goes stale when the document flips state in place

**Context:** After Rectify flipped a Posted inventory count back to Draft, the lines table stayed read-only until a full page reload.

**Problem:** `Table` read `forceEditMode` only as the `useState` initial value. Rectify/Post actions revalidate the route in place — the component never remounts, so the prop change never reached the state, and the Edit/Lock toggle is hidden while `forceEditMode` is set, leaving no way to recover. The same staleness applied in the opposite direction after posting a Draft (table looked editable on a read-only document).

**Rule:** When a prop derives from a document's mutable status (Draft/Posted etc.) and controls interaction mode, sync it with an effect (`useEffect(() => setEditMode(forceEditMode), [forceEditMode])`) or derive it instead of seeding state once. Test the transition without a reload — loader revalidation does not remount components.

**Applies to:** `apps/erp/app/components/Table/Table.tsx` (`forceEditMode`), any component seeding state from status-derived props on revalidating routes.

## journalLineDocumentType and itemLedgerDocumentType are different enums with near-identical value sets

**Context:** Adding GL posting for inventory adjustments: journal lines needed a `documentType` of `'Inventory Adjustment'`, and the plan also stamped the same value onto `itemLedger`/`costLedger` rows.

**Problem:** `journalLine.documentType` uses the `journalLineDocumentType` enum while `itemLedger.documentType` AND `costLedger.documentType` share the `itemLedgerDocumentType` enum. The two lists overlap heavily ('Inventory Count' exists in both) but are not identical — `'Inventory Adjustment'` existed in neither and was added only to `journalLineDocumentType`. Writing a journal-only value into a ledger column fails at runtime with an invalid-enum error, and stamping a new documentType onto manual-adjustment `itemLedger` rows would also have broken the "byte-identical ledger writes when accounting is disabled" guarantee (they are NULL today).

**Rule:** Before using a `documentType` string, check WHICH enum the target column uses (`\dT+` or grep the migration) — never assume the journal and ledger enums share values. When adding GL posting to an existing subledger flow, keep the subledger rows' shape unchanged (documentType stays whatever it was, usually NULL) and put the new linkage value on the journal lines only.

**Applies to:** `packages/database/supabase/migrations/` enum additions; `functions/shared/post-adjustment.ts`; any `post-*` function writing both `itemLedger`/`costLedger` and `journalLine`.

## Deno edge functions are not deno-check-clean — gate on own-file error deltas, not exit code

**Context:** Verifying new/edited Supabase edge functions (`post-inventory-adjustment`, `post-inventory-count`) with `deno check`.

**Problem:** `deno check` on ANY edge function fails with ~10–20 pre-existing errors from the shared dependency graph (TS2589 in `shared/get-next-sequence.ts`, kysely pool-config type skew, supabase-js generic inference collapsing to implicit-any callbacks). CI never runs `deno check`, so committed, working functions fail it — a red exit code proves nothing about the change, and chasing those errors means rewriting shared files out of scope.

**Rule:** Gate edge-function changes on the DELTA of errors attributed to the touched file: `deno check <file> 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -c "<file>:"` must not exceed the committed baseline (copy the HEAD version beside it to measure, e.g. `git show HEAD:<path> > <dir>/index.orig.ts`, check, delete). New code should contribute zero; annotate supabase-js callbacks with explicit row types instead of leaving implicit-any. Pure logic goes in a small module importing only `lib/types.ts` so `deno test` type-checks clean.

**Applies to:** `packages/database/supabase/functions/**` verification; `.claude/skills/check-and-commit` runs touching edge functions.

## Forking a SQL function migration silently drops sibling branches added since your fork base

**Context:** `complete_job_to_inventory` gained a Non-Inventory branch in `20260707022142` (services post WIP→COGS, no inventory artifacts). Six days later, two migrations (`20260713190909` raw-materials split, `20260713222236` overhead fix) each forked the function from the older `20260630092517` baseline — silently deleting the Non-Inventory branch. Service job completions then posted phantom Finished Goods until the branch was restored in `20260714043017`.

**Problem:** "Fork from the newest definition" fails when the author greps for the migration that matters to *their* change and misses intermediate redefinitions that added orthogonal branches. The dropped branch produces no error — the divergent behavior only surfaces when someone exercises the other feature.

**Rule:** Before redefining a function, list EVERY migration that touches it (`grep -l '<fn_name>' migrations/*.sql | sort`), and fork from the last one — then diff your new body against that exact file (`diff <(sed -n 'a,bp' newest.sql) <(...)`) so the only hunks are your intended edits. If the timeline shows a branch you don't understand (an `itemTrackingType` guard, a feature flag), it is load-bearing — carry it forward, never re-derive the body from an older file or memory.

**Applies to:** `packages/database/supabase/migrations/` — any `CREATE OR REPLACE FUNCTION` fork; reviews of migrations that redefine shared functions (`complete_job_to_inventory`, `backflush_job_materials`, `get_inventory_quantities`, sync interceptors).

## Job-completion side effects must live in complete_job_to_inventory, not in route actions

**Context:** Service-job fulfillment (advance the linked salesOrderLine on completion) was first implemented in the ERP `$jobId.complete.tsx` action after the RPC call. In e2e it never ran: the operator finished the last operation, and `sync_update_job_operation_quantities` → `sync_finish_job_operation` (DB interceptors) called `complete_job_to_inventory` directly — the ERP route was never involved.

**Problem:** Job completion has multiple entry points — the ERP Complete button AND the interceptor cascade that auto-completes when the last operation flips to Done (fired from MES quantity recording or ERP production quantities). Any completion side effect hooked at the app layer silently misses the interceptor path.

**Rule:** Side effects that must accompany job completion (fulfillment, status propagation, posting) go INSIDE `complete_job_to_inventory` — the single choke point every path crosses. Place them before the `accountingEnabled` / zero-WIP early returns if they must run unconditionally. App-layer completion hooks are only valid for effects the SQL function cannot perform (edge-function invocation — cf. `returnAllocatedRemaindersAtJobComplete`, orchestrated in TS for exactly that reason).

**Applies to:** `complete_job_to_inventory`; `apps/erp/app/routes/x+/job+/$jobId.complete.tsx`; `sync_finish_job_operation`; any future completion-triggered behavior (rev-rec POC recognition events).

## A `@ts-expect-error` on generated DB types is evidence of a dropped column, not a type quirk

**Context:** `InventoryTable.tsx` read `row.original.tags` behind a `// @ts-expect-error TS2339`. The suppression was correct that the property was missing — `20260713235406` had forked `get_inventory_quantities` and dropped the `tags` output added by `20260113122437` (the sibling-branch failure mode above). The regression then hid in plain sight for months: the Tags column silently rendered empty, and the Tags filter sent `.overlaps("tags", …)` → PostgREST 42703 against a nonexistent column.

**Problem:** Generated types are mechanically derived from the live schema, so TS2339 on a generated Row/Returns type is never a false positive — it is the type system reporting that the column does not exist. Suppressing it converts a compile-time regression signal into a silent runtime one. The blast radius was widened by `quantities.tsx` calling `redirect(...)` without `throw`, which discarded the resulting PostgREST error and rendered an empty table instead of surfacing it.

**Rule:** Never `@ts-expect-error` / `@ts-ignore` a missing property on a `@carbon/database` generated type. Grep every migration touching the function or table (`grep -l '<name>' migrations/*.sql | sort`) and find the revision that removed it — the fix is a migration restoring the column, not a suppression. When reviewing, treat a `@ts-expect-error` near generated types as a probable dropped-column regression. Corollary: in a loader, always `return` or `throw redirect(...)` on a service error — a `redirect(...)` that is neither returned nor thrown is a no-op that swallows the error and renders empty data.

**Applies to:** `packages/database/src/types.ts` consumers; `apps/erp/app/modules/**/ui/**` table columns bound to RPC outputs; any loader branching on `{ data, error }`.

## A mutually-exclusive primary/fallback branch breaks when the primary source can be legitimately empty

**Context:** The MES Issue dialog (`IssueMaterialModal`) pre-selects tracked lots from two sources: `pickedAllocation` (lots a picking list already picked) and `suggestedAllocation` (the FEFO/pickMethod suggestion of what to pick). It gated the suggestion off whenever a picking allocation merely existed (`shouldSuggestAllocation = … && !hasPickingAllocation`) and chose `seedAllocation = hasPickingAllocation ? pickedAllocation : suggestedAllocation`.

**Problem:** `hasPickingAllocation` was true when `quantityToPick > 0` — i.e. the material is ON a picking list — but `pickedAllocation` is only non-empty once something is physically PICKED (pickingListLineTrackedEntity rows are written at pick time, never at allocation). For a material on an In-Progress list that hasn't been picked yet (common in a multi-line list where other lines were picked first), the primary branch was selected but resolved empty, the suggestion was gated off, and the seed effect bailed → operator got the default first lot instead of the recommendation. The two conditions "should we prefer picked lots" and "do picked lots exist" were conflated.

**Rule:** When one data source is the preferred seed and another is the fallback, branch on whether the preferred source actually HAS data (`primary.length ? primary : fallback`), and load the fallback unconditionally — do not gate the fallback off on a proxy signal (here `hasPickingAllocation`) that can be true while the primary is still empty. Verify the "primary exists but is empty" state explicitly, since it's the one static reading and happy-path testing both miss.

**Applies to:** `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx` (picked vs suggested allocation seeding); any picking-list-aware UI that distinguishes allocated-but-not-picked from picked (`pickingListLineTrackedEntity.quantityPicked > 0`).

## PostgREST inserts NULL (not the DB default) for a present-but-`undefined` key spread into an insert

**Context:** Creating a Fixed Asset sales-order line failed with `23502 null value in column "methodType" violates not-null constraint`, even though `salesOrderLine.methodType` is `NOT NULL DEFAULT 'Pull from Inventory'`. The validator (`salesOrderLineValidator`) intentionally coerces the form's empty `methodType` to `undefined` for Fixed Asset / Comment lines (`zfd.text` + a refine that exempts them). The action spreads `...validation.data` into `upsertSalesOrderLine`, whose insert path spreads `...salesOrderLine` — so the object still carries `methodType: undefined`. A raw psql insert omitting the column succeeded (used the default); the app's PostgREST insert did not.

**Problem:** `postgrest-js` builds its `?columns=` list from `Object.keys(row)`, which **includes keys whose value is `undefined`**. `JSON.stringify` then drops the value from the body, so PostgREST sees the column listed with no value and inserts `NULL` — it does **not** fall back to the column `DEFAULT`. A truly absent key (never spread, e.g. `id`) is excluded from `?columns=` and does get its default. This is why the sibling **update** path was fine: it runs `sanitize(...)`, which strips `undefined`/empty keys before the write. Only the **insert** path (which didn't sanitize) leaked the `undefined` key.

**Rule:** When spreading validated/optional data into a supabase-js `.insert(...)`, a NOT-NULL column with a DB default will still fail if the key is present-but-`undefined`. Either (a) supply the value explicitly at the insert site next to the other defaults (`methodType: x.methodType ?? "Pull from Inventory"`), (b) `sanitize(...)` the insert object so undefined keys are dropped (matches the update path), or (c) pass `{ defaultToNull: false }` to `.insert(...)` (sends `Prefer: missing=default`). Prefer (a) for a single column, (b) for consistency with an existing update path. Don't assume the DB `DEFAULT` will apply — it only does for keys entirely absent from the object.

**Applies to:** `upsertSalesOrderLine` (`apps/erp/app/modules/sales/sales.service.ts`); any `upsert*` whose insert branch spreads optional/validated fields into a table with NOT-NULL-DEFAULT columns (sales/purchase/quote/invoice line inserts especially, which all carry a NOT NULL `methodType`).

## Twin `ValidatedForm`s at the same JSX slot share one RVF store — controlled-field defaults seed only for whichever branch mounts first

**Context:** The Add Affected Item modal (`AffectedItemForm`) renders `isNewPart ? <ValidatedForm A/> : <ValidatedForm B/>`. Branch A (New Part) has `replenishmentSystem`/`itemTrackingType` Selects with `defaultValues` `"Make"`/`"Inventory"`; branch B (existing item) has an item picker. After switching to New Part the two Selects rendered blank and submit failed with `Invalid enum value … received ''`.

**Problem:** Both branches render a `<ValidatedForm>` (same element type) at the **same JSX position**, so React reconciles them as **one component instance** and just swaps props — no unmount/remount. `@carbon/form`'s RVF store seeds `controlledFields.values` from `defaultValues` **only on first hydration** (`syncFormProps`: `if (!state.isHydrated) { … }`). The instance hydrates on the initial branch (B, `changeType` default `Version`), so when the user switches to A, A's Select defaults are **never** seeded — `useControlledFieldValue` returns the store value (`undefined`) once `isHydrated`, not the `defaultValue`. Uncontrolled fields (`InputControlled`) were unaffected because they write their own value via effect. `defaultValues` object identity was a red herring: `ValidatedForm` already `useDeepEqualsMemo`s it, and `syncFormProps` ignores later `defaultValues` changes post-hydration.

**Rule:** When two `ValidatedForm`s occupy the same conditional slot (`cond ? <VF/> : <VF/>`), give each a distinct, stable `key` (`key="new-part"` / `key="existing-item"`) so switching forces a fresh mount + fresh store that hydrates with the correct branch's `defaultValues`. Consequence: the fresh mount also needs any Select value the branch relies on seeded in its own `defaultValues` (e.g. `changeType: "New Part"`, added to `changeOrderNewPartValidator`) — a value the shared store previously carried over from the user's click is gone after remount. Symptom to watch for: a controlled Select rendering blank / submitting `""` right after a branch switch.

**Applies to:** `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemForm.tsx`; any conditional twin-`ValidatedForm` pattern; `@carbon/form` controlled fields (`Select`/`Combobox`/anything on `useControlField`) that rely on `defaultValues` seeding.

## Never blind-pop a stash in a Conductor worktree — the stash stack is shared/stale

**Context:** During /execute, proving an erp typecheck failure pre-existing by temporarily parking three edited files with `git stash push -u <paths>` in a Conductor workspace.

**Problem:** The `stash push` failed ("could not write index" — likely a concurrent git process from a sibling workspace; untracked-file pathspecs also fail plain `stash push`). No stash was created, but the follow-up `git stash pop` applied the TOP of the existing stash stack — an old stash from a *different branch's* work — half-applying unrelated files with merge conflicts (`UU`) and staged changes that then had to be surgically reverted.

**Rule:** In Conductor/multi-worktree checkouts, don't use `git stash` for temporary file parking at all. Prove a failure is pre-existing with `git show HEAD~1:<file>` / `git log -- <file>` / a merge-base check instead. If stash is truly unavoidable: verify the push succeeded AND `git stash list` shows YOUR entry at stash@{0} before ever popping, and never `pop` after a failed `push`.

**Applies to:** any git stash usage in Conductor workspaces; /execute and /check-and-commit loops; proving pre-existing test/typecheck failures.

## A public SECURITY DEFINER function that calls net.http_post is a remote-DoS surface — put it in an internal schema

**Context:** The push-based event-queue wake (`20260721184852_event-queue-wake.sql`) originally defined `wake_event_queue()` / `sweep_event_queue()` in the `public` schema. Both are SECURITY DEFINER and call `net.http_post` (pg_net) to POST to the `event-wake` edge function. The trigger (`dispatch_event_batch`) and pg_cron call them as the owner (superuser).

**Problem:** Every `public` function is auto-exposed as a PostgREST RPC (`/rest/v1/rpc/<name>`), reachable by `anon`. Worse than mere exposure: referencing such a function as a **non-superuser** role segfaults the backend (pg_net 0.20 / PG15) — reproducible via `SET ROLE authenticated; EXPLAIN SELECT public.wake_event_queue();`, which crashed even though `EXPLAIN` never runs the body and the role lacked EXECUTE. The crash happens at plan/permission-resolution time, **before** the ACL check — so `REVOKE ALL … FROM PUBLIC, anon, authenticated` does NOT protect: an unauthenticated `POST /rpc/wake_event_queue` crash-loops the whole DB (postmaster reinitializes all backends → "database system is in recovery mode" for every client). Same-body call as superuser was fine, which is why the trigger/cron paths worked and masked it in end-to-end testing.

**Rule:** Never define an internal SECURITY DEFINER helper (especially one calling `net.http_post` / pg_net) in `public`. Put it in the internal `util` schema (the existing Carbon/Supabase convention — cf. `util.process_embeddings`), where `anon`/`authenticated` have no `USAGE`, so the API can't reference it at all and a hostile call fails cleanly with `permission denied for schema util` before any crash-prone planning. Callers that are triggers/pg_cron run as owner and reach `util` fine; update their bodies to `util.<fn>()`. Keep `REVOKE ALL … FROM PUBLIC` on the util function as defense-in-depth, but the schema-USAGE gate is the real fix. Verify with `SET ROLE authenticated; SELECT util.<fn>();` → must be a clean `permission denied`, not a dropped connection. Note PostgREST-exposed schemas exclude `util`/`pgmq` but include `public`/`net` (`has_schema_privilege('anon', <schema>, 'USAGE')`).

**Applies to:** any new SECURITY DEFINER function that calls pg_net/`net.http_post` or is meant to be trigger/cron-only (`packages/database/supabase/migrations/`). Trigger functions returning `trigger` are not RPC-exposed (safe in public), but VOID/scalar helpers are.

## The local Inngest dev server (v1.19.4) can't handle `debounce` — it errors on every debounce item

**Context:** The push-based event-queue drainer (`packages/jobs/src/inngest/functions/events/queue.ts`) was configured with `debounce: { period: "2s", timeout: "10s" }` to coalesce bursts of `carbon/event-queue.process` wake events into one run.

**Problem:** The Dockerized dev server (`inngest/inngest:v1.19.4`, run by `crbn up`) logs `error unmarshalling debounce item: json: cannot unmarshal array into Go struct field DebounceItem.e.data of type map[string]interface {}` on every debounced event, fails to coalesce (a 20-write burst produced 21 runs, not ~1), and spams the error each time the function is triggered (including every pg_cron sweeper tick). Fails open — events still process, queue still drains, nothing is lost — but the optimization is absent in dev and the logs are noisy. Inngest Cloud honors debounce; the dev server does not.

**Rule:** Don't rely on `debounce` for Carbon Inngest functions validated against the local dev server — it's broken there. For the event queue the coalescing was moved upstream: `dispatch_event_batch()` wakes at most once per transaction (txn-local GUC `carbon.event_wake_sent`), so the important bulk case (a CSV import = one transaction) is already one wake; `concurrency: 1` + loop-until-empty drain absorbs the rest (extra runs from many separate transactions are cheap no-ops that read an empty queue). If you must coalesce many *separate* transactions in a burst, do it at the DB/application layer, not with `debounce`. Verify any flow-control choice by watching `docker logs <inngest container>` for `error handling queue item` during a burst, not just by trusting the config.

**Applies to:** `packages/jobs/src/inngest/functions/events/queue.ts`; any new Inngest function reaching for `debounce`/flow-control that will be exercised in local dev.

## Regenerating `src/email/previews/` fixtures requires a follow-up biome format pass

**Context:** Adding ChangeOrder* entries to `packages/documents/scripts/generate-notification-previews.mjs` and re-running it to emit the per-event preview fixtures.

**Problem:** The generator writes raw `JSON.stringify(..., null, 6)` output (quoted keys, 6-space indent), but the committed fixtures are biome-formatted (unquoted keys, 2-space indent). Re-running the script therefore rewrites **all** existing fixtures into the raw style — 28 files of pure formatting churn drowning the 3 intended new files in the diff.

**Rule:** After running `generate-notification-previews.mjs`, always run `pnpm exec biome check --write packages/documents/src/email/previews/` before reviewing the diff. Only intended fixture changes should remain; if pre-existing fixtures still show as modified, something else changed.

**Applies to:** `packages/documents/scripts/generate-notification-previews.mjs`, `packages/documents/src/email/previews/*`, and any generator whose committed output is formatter-normalized.

## Turbo typecheck/test runs can regenerate `@carbon/database` artifacts as ride-along churn

**Context:** Running `pnpm exec turbo run typecheck --filter=erp` and `turbo run test --filter=@carbon/jobs` to verify unrelated changes (notification filter, invite-link fix).

**Problem:** Turbo builds dependency packages first, and a `@carbon/database` build step regenerated `src/types.ts` (nondeterministic FK-relationship ordering), `src/swagger-docs-schema.ts`, and `supabase/functions/lib/types.ts` — none of which the task touched. Committing them would mix generated-file drift into an unrelated PR; the drift can also reflect whatever local DB happens to be running, not migrations.

**Rule:** After any turbo run, check `git status` for modified generated files under `packages/database/` before committing. If you didn't intentionally run `pnpm run generate:types`, revert them (`git checkout -- packages/database/src/... packages/database/supabase/functions/lib/types.ts`). Regenerate deliberately and separately when schema actually changed.

**Applies to:** `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `packages/database/supabase/functions/lib/types.ts`; any branch running turbo tasks that build `@carbon/database`.

## Storage keys built from raw filenames break silently — always sanitize, and the portal share route regex is a hidden contract with every upload path shape

**Context:** MES file/inspection step uploads (`RecordModal` in `apps/mes/app/components/JobOperation/components/Step.tsx`) put the raw `file.name` into the Supabase storage key. macOS screenshot names contain U+202F (narrow no-break space before "AM/PM"), which is outside Supabase storage's allowed-key charset.

**Problem:** The upload fails with "Invalid key", but the modal had already rendered the file card (`setFile` before the await), so the operator saw the file "attached" with the Record button permanently disabled — no actionable error. Separately, the customer-portal file route (`share+/customer.$id.$.tsx`) validated paths with a regex hardcoded to the *old* flat layout `companyId/job/operationId/file`; when `032f8d0e` nested step uploads under `/stepId/nanoid/`, every portal file link started returning 403 and nobody noticed for months.

**Rule:** (1) Any storage key that embeds a user-controlled filename must pass it through `stripSpecialCharacters` (canonical copy in `@carbon/utils`, re-exported by `~/utils/string` in ERP) with a `|| "file"` fallback for names that sanitize to empty. (2) The share-route path validation (`parseJobFilePath` in `apps/erp/app/utils/supabase.ts`, unit-tested) is coupled to every writer of the `companyId/job/...` prefix — changing an upload path shape requires updating the parser and its test in the same PR. (3) On upload failure, reset the picker UI so the user can retry; never leave a dead-end state.

**Applies to:** all `storage.from(...).upload(...)` call sites in `apps/mes` and `apps/erp`; `share+/customer.$id.$.tsx`; any new externally-shared file route.

## Document totals helpers guarded on truthy qty/price silently drop shipping- or tax-only lines

**Context:** Adding line-level shipping cost display to the purchase order PDF (`packages/documents/src/pdf/blocks/purchaseOrder/`). A PO line with a 0.00 unit price and a 30.00 `supplierShippingCost` rendered Total and Subtotal as 0 on the PDF.

**Problem:** The totals helpers in `packages/documents/src/utils/` (`purchase-order.ts` `getLineTotal`/`getTotal`, and the same pattern in `sales-order.ts`/`sales-invoice.ts` `getLineSubtotal`/`getLineTaxableSubtotal`) wrapped the whole formula in `if (line?.qty && line?.unitPrice)` — so any line whose value was only shipping, add-on, or tax contributed 0 to the document, even though those amounts were displayed elsewhere on the page and included in posting math.

**Rule:** Compute document money formulas unconditionally with `?? 0` per term — never gate the whole formula on one term being truthy. Also keep a document's Subtotal semantics identical to that module's in-app summary (PO PDF Subtotal = qty × price + line shipping, matching `PurchaseOrderSummary.tsx`), and lock the helpers with unit tests (`packages/documents/src/utils/document-totals.test.ts`).

**Applies to:** `packages/documents/src/utils/{purchase-order,sales-order,sales-invoice,quote}.ts`, PDF Summary/LineItems blocks, `email/{PurchaseOrder,SalesOrder,SalesInvoice}Email.tsx`, and any new document totals code.

## Loader-computed "current unit" must match the component's, or per-unit attribution credits the wrong unit

**Context:** The MES assembly view resolves the unit on screen twice: the loader (`apps/mes/app/routes/x+/assembly.$operationId.tsx`) computes `unitIndex` from `?unit`/`?trackedEntityId`, and `AssemblyView.currentUnitIndex` computes it again client-side. Per-unit material issue attribution (batch parents) was moved into the loader, keyed off the loader's `unitIndex`.

**Problem:** The two defaults diverged. When there's no `?unit` param, `AssemblyView` lands on the NEXT unit still to build (`min(quantityComplete, units.length-1)`) — and the auto-complete effect DELETES `?unit` after finishing a unit — but the loader defaulted `unitIndex` to `0`. So on unit 2 (default landing) the loader attributed unit 1's stamped consumes (`Unit=1`) to the unit-2 view: parts showed `1/1`/`2/1` though nothing was issued to unit 2, and the scan gate (which reads the same values) let the operator Mark done. Serial parents were unaffected (attribution is per-entity, and both default to 0).

**Rule:** When a loader and its component both compute the same "current X" and one feeds data the other renders, their resolution logic — including the no-param default — must be identical. For the assembly loader, mirror `AssemblyView.currentUnitIndex`: index-paged (batch/untracked) parents default to `min(quantityComplete, opQty-1)`, serial parents to `0`. If you make a loader-computed index load-bearing for attribution, re-derive it the exact same way the UI does.

**Applies to:** `apps/mes/app/routes/x+/assembly.$operationId.tsx` (`unitIndex`) ↔ `apps/mes/app/components/AssemblyView.tsx` (`currentUnitIndex`); any loader/component pair where one computes an index the other renders.

## Node-side re-exports from the Deno functions tree must dodge lib/database.ts

**Context:** `@carbon/database` re-exports code from `packages/database/supabase/functions/` into the node world (`src/client.ts` → `lib/postgres/index.ts`). The shared inspection engine (`src/quality.ts`) needed `getNextSequence` from `supabase/functions/shared/get-next-sequence.ts`, which imported its `DB` type from `../lib/database.ts`.

**Problem:** `lib/database.ts` imports `./driver.ts` — the Deno-postgres driver whose types (`queryObject`, deno `Pool`) don't typecheck under the node tsconfig. Pulling any `shared/*.ts` helper that touches `lib/database.ts` into a `src/*` file breaks `pnpm --filter @carbon/database typecheck`, even though the runtime graph would have been fine.

**Rule:** When making a Deno-tree helper importable from `packages/database/src/*`, its type-only imports must come from `../lib/postgres/index.ts` (node-clean, already the `src/client.ts` re-export source), never `../lib/database.ts`. `import type { KyselyDatabase as DB } from "../lib/postgres/index.ts"` is behavior-neutral for Deno. Check the full import chain (`lib/utils.ts` is safe; `lib/database.ts`/`lib/driver.ts` are not) before re-exporting.

**Applies to:** `packages/database/src/{client,sampling,quality}.ts`; any future node-side re-export of `packages/database/supabase/functions/{shared,lib}/*`.

## A zod `.refine` that returns an object instead of a boolean silently disables the check

**Context:** Cross-field validation in module `*.models.ts` zod schemas (real case: `processValidator` in `apps/erp/app/modules/resources/resources.models.ts`, lines 305–319).

**Problem:** `.refine((data) => { if (bad) return { workCenters: ["..."] }; return true; })` looks like it reports a field error, but `.refine`'s callback is coerced to a boolean — any non-empty object is **truthy**, so the "failure" branch returns a value that passes validation. Both `processValidator` refinements (work-center-required and standard-factor-required) never fire: the object was meant to be an error map, but `.refine` has no such API. The schema typechecks and the form submits, so the missing validation is invisible until bad data lands.

**Rule:** A `.refine` predicate must return a **boolean** (`false` = invalid). To attach a path/message, either pass the second `{ message, path }` argument to `.refine` and return `false` on failure, or use `.superRefine((data, ctx) => ctx.addIssue({ path, message }))` when you need per-field errors. Never return an object/array from a `.refine` callback expecting it to be an error map.

**Applies to:** all `apps/erp/app/modules/**/*.models.ts` (and `apps/mes/app/services/models.ts`) zod schemas using `.refine`.

## `ON DELETE SET NULL` on a composite FK nulls every referencing column, not just the pointer

**Context:** A nullable pointer column that references a sibling table on Carbon's composite key, e.g. `workflow.activeVersionId` → `workflowVersion("id", "companyId")` (`20260730142317_workflows-foundation.sql`). Because every Carbon table is keyed `("id", "companyId")`, any such pointer FK is necessarily multi-column and includes `companyId`.

**Problem:** A bare `FOREIGN KEY ("activeVersionId", "companyId") REFERENCES ... ON DELETE SET NULL` sets **all** referencing columns to NULL when the parent row is deleted — including `companyId`, which is `NOT NULL`. The delete then fails with `null value in column "companyId" of relation "workflow" violates not-null constraint`, and the referenced row can never be deleted. It looks correct in review, applies cleanly, and only surfaces the first time something deletes the parent.

**Rule:** On a composite FK whose referencing columns include `companyId` (or any NOT NULL column), name the column in the action: `ON DELETE SET NULL ("activeVersionId")`. The column-list form needs Postgres 15+ (the local stack is 15.14). Same trap applies to `ON UPDATE SET NULL` and to `SET DEFAULT`. Always prove it with a real delete against the live schema — a migration that applies successfully tells you nothing about its referential actions.

**Applies to:** any migration adding a nullable pointer column that references another table's composite `("id", "companyId")` key.

## A read-time format-migration seam must run before the current-schema parse

**Context:** Versioned JSON documents stored in a JSONB column with a
`formatVersion` sibling column, upgraded on read so stored rows never need a
backfill (`packages/documents/src/template/`, `packages/workflows/`).

**Problem:** `packages/workflows` originally parsed the row against the *current*
zod schema and only then called `migrateDefinition`. A document old enough to need
migrating cannot satisfy the current schema by definition, so it failed the parse
and never reached the migration — the seam was dead on arrival. Worse, the parse
failure fell back to an empty canvas, so opening the version in the builder showed
nothing and the next save silently destroyed the stored nodes.

**Rule:** Run the migration on the **raw** JSON, before the current-schema parse.
Default a missing `formatVersion` to `1`, never to `CURRENT_*_FORMAT_VERSION` —
"current" skips the very migration a legacy row needs. Treat a `formatVersion`
greater than current as an explicit failure, and return a discriminated
`{ok: false, failure, message}` rather than an empty document, so a caller can
refuse to save over a row it could not read.

**Applies to:** any read-time `migrate*(payload, _from)` seam —
`packages/workflows/src/definition/normalize.ts`,
`packages/documents/src/template/defaults.ts`.

## A `default:` arm silently defeats discriminated-union exhaustiveness

**Context:** Several functions switching on the same discriminated union
(`WorkflowNode["type"]` across handles, refs, outputs, type checks, config checks).

**Problem:** Five switches each had a `default:` or simply returned `undefined`
for unhandled members, so adding a seventh node type produced **zero** compile
errors — verified with `tsgo --noEmit`. The new node type got default handles and
no validation at all, and would activate.

**Rule:** For behaviour that must exist for every member of a union, prefer one
record keyed by a mapped type (`{ [K in Kind]: ... }`) over N switches: a missing
key is a `TS2741` error. Where a switch is genuinely right, omit `default:` and end
with a `never` assertion. A `Record<Union, T>` gives the same guarantee — that is
what caught the missing `OPERATOR_LABELS` entries when `Operator` was extended.

**Applies to:** `packages/workflows/src/definition/nodes.ts`, and any
`switch (x.type)` over a zod discriminated union.

## A generated catalog must key entity refs off the schema, not off a hand-written hint

**Context:** The workflow event catalog's entity registry lets a watched column
declare `ref: "supplier"`, which becomes `entity("supplier")` in the generated
property map so a customer can dot-chain `record.supplierId.name`.

**Problem:** `ref` was needed for real — composite foreign keys like
`(supplierId, companyId)` carry no `<fk table=…>` note in
`packages/database/src/swagger-docs-schema.ts`, so `purchaseOrder.supplierId`
has no detectable target. But a hand-written hint is a hand-written lie waiting
to happen: `customer.salesContactId` was declared `ref: "user"` when its foreign
key actually targets `customerContact`. Nothing would have caught it, and every
dot-path through that property would have resolved against the wrong entity.

**Rule:** Where a generator accepts a hand-written type hint alongside a
machine-readable source, make disagreement a hard error rather than letting the
hint win silently. `buildCatalog` throws when a declared `ref` conflicts with a
foreign key present in the schema, and only uses `ref` where the schema is
genuinely silent. Audit every existing hint against the real source before
trusting a slate that came from a design document.

**Applies to:** `packages/workflows/src/catalog/build.ts`, and any hand-curated
overlay on generated schema data (`packages/database/src/audit.config.ts`'s
`snapshotFields` / `fkDisplayRegistry`).

## Lingui's `msg` macro forces generated translatable strings into their own file

**Context:** The generated workflow catalog needs a human label per event, and
Carbon's convention outside React is `msg` from `@lingui/core/macro`.

**Problem:** `msg` is a **build-time babel macro**. A generated file containing
one can only ever be imported by Vite-built app code — importing it from plain
Node throws, which would break the phase-3 matcher in `packages/jobs`, every
`tsx` script, and any vitest run that touches the catalog.

**Rule:** Split the artifact: `events.generated.ts` carries the runtime data and
imports nothing from `@lingui/*`; `labels.generated.ts` carries only `msg``
descriptors keyed by id and is excluded from the package barrel. Tooling that
must read the labels reads the file as **text** (regex the keys) rather than
importing it — `scripts/check-workflow-catalog.ts` does exactly that. Never put a
`label` field on the runtime type; it would always be undefined.

**Applies to:** `packages/workflows/src/catalog/`, and any future generated file
that needs both translatable strings and a Node-side consumer.

## `apps/erp` targets ES2019, so `packages/workflows` cannot use BigInt literals

**Context:** The workflow engine needed a stable 64-bit hash for batch item keys,
and the plan specified FNV-1a via `BigInt`.

**Problem:** `apps/erp/tsconfig.json` sets `"target": "ES2019"` and compiles
workspace package **source**, not built output. A `0xcbf29ce484222325n` literal
in `packages/workflows` fails the erp typecheck with TS2737 even though the
package's own `tsgo --noEmit` passes — the package config targets `esnext`.

**Rule:** Anything in a package `apps/erp` imports must be ES2019-safe. Reach for
`Math.imul` and two 32-bit passes rather than one 64-bit BigInt pass. Always run
`pnpm exec turbo run typecheck --filter=erp` after touching a shared package —
the package's own typecheck is not the binding constraint.

**Applies to:** every `packages/*` that `apps/erp` imports; `packages/workflows`
doubly so, since the phase-7 builder also compiles it for the browser
(no `node:crypto` either).

## A change trigger's `before` and `after` share a record id, so an id-keyed cache collapses them

**Context:** The workflow engine caches loaded records per run, keyed
`${entity}:${id}`, and a record trigger hands out `record`, `before` and `after`.

**Problem:** All three are the same row id. Seeding one cache from all three
means whichever is written last wins, so `before.orderTotal <= 10000` silently
reads the **new** total — quietly defeating the PRD's whole "went up" case. Both
the spec and the plan missed this.

**Rule:** An entity `RuntimeValue` carries an optional inline `row`.
`triggerOutputs` attaches each trigger row to its own value, and seeds the shared
cache with the **current** state only (`record`/`after`). Never put a historical
snapshot into a cache keyed by identity alone.

**Applies to:** `packages/jobs/src/workflows/engine/loader.ts`,
`packages/workflows/src/runtime/`, and any future cache of "the record as it is"
that also has to represent "the record as it was".

## The `user` table has no `companyId`, so the usual tenancy check cannot be applied to it

**Context:** The workflow update executor must prove that every entity-typed
value it writes belongs to the acting company, or a workflow could point a row at
another tenant's record. The plan specified one generic
`select id where id = ? and companyId = ?` for that check.

**Problem:** Every entity-typed writable column in the workflow catalogue is an
assignee, and they all point at `user` — which is one of the few Carbon tables
with **no** `companyId` column. The literal check would have 400'd on every
assignee write, i.e. on every workflow that assigns anybody.

**Rule:** Membership for `user` is `userToCompany(userId, companyId)`, not a
column on the row. Route those entities through that join instead of skipping the
check — dropping it is the tenancy hole the check exists to close. Before writing
a "every table has `companyId`" helper, confirm it for the specific tables it
will actually receive.

**Applies to:** `packages/jobs/src/workflows/actions/update.ts`, and any generic
company-scoping helper that takes a table name at run time.

## Biome drops quotes from valid identifier keys, so a drift check that greps for `"key":` misses them

**Context:** `scripts/check-workflow-catalog.ts` verifies the committed generated
catalogue matches what the generator would produce, partly by grepping the label
file for its keys.

**Problem:** The generator emits `"notify":` but Biome formats the committed file
to `notify:`. A regex anchored on `^ {2}"([^"]+)":` therefore skipped exactly the
keys that happen to be valid JS identifiers — the check passed while genuinely
missing entries.

**Rule:** A check that reads a **formatted** generated file must tolerate the
formatter's output, not the generator's. Make the quotes optional
(`^ {2}"?([^":\s]+)"?:`), or compare parsed data rather than text.

**Applies to:** `scripts/check-workflow-catalog.ts` and any future drift check
that greps a Biome-formatted generated file.

## Never hand-measure React Flow handle positions; and never `stopPropagation` inside a node

**Context:** `apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx` needed one
source handle per condition path, and needed nodes draggable from their body.

**Problem:** Two separate self-inflicted bugs. (1) Handle rows were measured with
`getBoundingClientRect()` and the offset written to `style.top`. `getBoundingClientRect()`
returns **zoom-scaled** pixels but `style.top` is applied *inside* the zoom transform,
so every handle sat at the wrong height at any zoom except 1.0 — and the effect
depended on the freshly-built `ports` array, so it re-ran and re-set state every
render. (2) The body used `onPointerDown={e => e.stopPropagation()}` on interactive
targets to stop React Flow dragging. React's `stopPropagation` also stops the native
event reaching `document`, and Radix `DismissableLayer` dismisses on a document-level
`pointerdown` — so every dropdown inside a node became impossible to close.

**Rule:** React Flow measures handle bounds from the DOM itself (zoom-aware) — put
the `<Handle>` inside a `position: relative` row and let its default
`.react-flow__handle-right` CSS anchor it; call `useUpdateNodeInternals(nodeId)`
when the handle set or node size changes, and never compute `top`/`right` yourself.
To exempt something from dragging, toggle React Flow's own `nodrag` class (a
capture-phase `pointerdown` listener runs before its bubble-phase drag listener) —
never `stopPropagation`, which silently breaks every portalled overlay's dismissal.

**Applies to:** `apps/erp/app/modules/workflows/ui/Builder/**`, and any `@xyflow/react`
canvas hosting Radix popovers/selects.

## The design-system `Card` is a gray tray + shadow edge — the white surface is `CardContent`, and a tint on the shell needs a `dark:` variant

**Context:** Building card surfaces with `@carbon/react`'s `Card` family (`packages/react/src/Card.tsx`), e.g. the onboarding Implementation Hub (`packages/onboarding/src/ui/**`). Three separate traps hit in sequence while converting hand-rolled `rounded-lg border bg-card` blocks to the design system.

**Problem:**
1. `Card` is `bg-accent dark:bg-card` — a **muted gray tray** in light mode, not a white card. Putting content directly in `<Card>` reads gray. The white surface (`bg-card`) comes from `CardContent`; the canonical composition is `Card > CardHeader + CardContent` (see `MetricCard.tsx`, `ActionTaskList.tsx`).
2. `Card`'s `shadow-button-base` already draws the crisp outer edge (a `0 0 0 1px` ring + inset highlights). A `CardContent` `border` sitting on top of that shadow ring reads as a **blurry double line**.
3. Overriding the shell background with an **un-prefixed** color (`bg-emerald-500/5`) leaves `Card`'s base `dark:bg-card` in the class list; `.dark .dark:bg-card` out-specifies `.bg-emerald-500/5`, so the tint **silently disappears in dark mode** (border/icon still show, so it degrades quietly).

**Rule:**
- Single-surface white card: `Card > CardContent` (not content directly in `Card`).
- Titled card: heading in `CardHeader` over `CardContent`; the shell shadow is the outer edge, so use `CardContent className="border-0"` and put the header/body divider on the `CardHeader` (`border-b border-border`) — never a full `CardContent` border on top of the shadow.
- Colored callout on a `Card`: always pair the tint with its `dark:` variant (`bg-emerald-500/5 dark:bg-emerald-500/5`). `cn`/twMerge then drops the base `dark:bg-card`. Verify by checking the rendered class list no longer contains `dark:bg-card`.

**Applies to:** any UI composing `@carbon/react` `Card`/`CardContent`/`CardHeader`; the `Section`/`Panel` primitives in `packages/onboarding/src/ui/primitives/Section.tsx` centralize this composition for the hub.

## A dropdown that lives inside an editor popup must own its keys on the document, not take them from its host

**Context:** The workflow builder's variable menu (`apps/erp/app/modules/workflows/ui/Builder/fields/VariableTreeMenu.tsx`), hosted both inside a tiptap suggestion popup and inside a Radix popover. Arrow-key navigation stayed dead across two rounds of fixes.

**Problem:** The menu exposed a `ref` handle and relied on each host to call it — the tiptap suggestion plugin's `onKeyDown` delegation in one case, the popover search input's `onKeyDown` in the other. That chain is long (ProseMirror direct props → plugin order → `ReactRenderer` ref → imperative handle) and every link is invisible when it breaks: the menu still renders, so the failure looks like "keys do nothing" with no error anywhere. Debugging it by reading the chain repeatedly produced plausible-but-wrong root causes.

**Rule:** Bind the navigation keys in a `document` `keydown` listener in the **capture** phase, inside the menu component itself, and `preventDefault()` + `stopPropagation()` only for keys it claims. The host then cannot swallow or fail to forward anything, and both hosts get identical behaviour for free. Guard the listener on the menu's own root being connected and visible — a popup that is *hidden* rather than unmounted (tippy's `hide()`) leaves the component mounted and would keep eating keys. Never claim `Escape`; dismissal belongs to the wrapping popup. Keep DOM focus in the field being typed into (search-as-you-type depends on it) and mark the highlighted row `aria-selected` instead of focusing it.

**Applies to:** any menu rendered by tiptap's `ReactRenderer` or otherwise mounted outside the React tree that owns the focused input.
## react-aria compares `formatOptions` by reference — an inline literal wipes half-typed numbers

**Context:** Any `NumberField` / `Number` / `NumberControlled` field that passes `formatOptions={{ ... }}` at the call site (real case: the MES Log Completed quantity in `apps/mes/app/components/JobOperation/components/QuantityModal.tsx`, where operators could not enter `1.5`).

**Problem:** `useNumberFieldState` (`@react-stately/numberfield`) guards with `formatOptions !== prevFormatOptions` — a **reference** check — and on a change calls `setInputValue(format(numberValue))`, replacing whatever is in the input with the last *committed* number. `react-aria-components`' `NumberField` spreads caller props straight through, so an inline object literal is a new reference every render. Any parent re-render while the user is mid-edit destroys the in-progress text. Commit only happens on blur/Enter/stepper, so a single digit usually survives but a decimal (`1.` → `1.5`, two-plus keystrokes) reliably does not. It reads as "the field doesn't support decimals" even though the format options, the zod validator, and the numeric DB column all allow them.

**Rule:** Never let an unstable `Intl.NumberFormatOptions` reference reach react-aria. `packages/react/src/Number.tsx`'s `NumberField` now stabilizes it via `useStableFormatOptions` / `areNumberFormatOptionsEqual` (shallow value compare — exact, since the options are all primitives), so call sites are free to pass literals. If you build another react-aria wrapper that forwards `formatOptions`, do the same; do not "fix" this class of bug by only adding/adjusting `formatOptions` at the call site — that is what introduced it here. Also note the same trap for any react-aria prop compared by identity.

**Applies to:** `packages/react/src/Number.tsx`; every `formatOptions={{ ... }}` call site in `apps/erp` / `apps/mes` (~144); `packages/form/src/components/{Number,NumberControlled,ArrayNumeric}.tsx`, whose `rest.formatOptions ?? ({ ... })` default also allocates a fresh object each render.

## Returns must not decrement pickingListLine.quantityPicked — the status trigger demotes terminal headers

**Context:** Building the picked-material return sweep (spec `.ai/specs/2026-08-04-picked-material-return-timing.md`). The original `returnPickedRemainder` case in `post-picking` decremented `pickingListLine.quantityPicked` when flushing un-consumed staged stock back to the warehouse at job complete.

**Problem:** `update_picking_list_status` (AFTER UPDATE ROW on `pickingListLine`, newest body `20260728120100`) fires on any `quantityPicked` change. After the decrement the line satisfies `quantityPicked < quantityToPick`, so the trigger's work-remains branch moves a `Completed`/`Partial` picking-list header back to **In Progress** — the automatic job-complete sweep was silently reopening completed picking lists. The demotion is CORRECT for an operator unpick (work regression); it is wrong for a post-completion return.

**Rule:** Book returns on `pickingListLine.quantityReturned` (added `20260804111631`) and leave `quantityPicked` as gross-picked; net staged at lineside = `quantityPicked − quantityReturned`. Only genuine unpicks (operator reversing work) may decrement `quantityPicked`. Any new writer of `pickingListLine.quantityPicked`/`status` must first check what `update_picking_list_status` will do with the change. `pickingListLineTrackedEntity` allocations are different — returns DO decrement those (availability RPCs net them out; no trigger watches that table).

**Applies to:** `packages/database/supabase/functions/post-picking/index.ts` (all return/unpick cases), `update_picking_list_status` migrations, any code mutating `pickingListLine` quantities.

## Audit FK snapshots: constraint-less columns are invisible to schema discovery; junction targets need hops

**Context:** Audit-log diffs resolve FK ids into frozen display names ("Location: Chicago → Dallas") via `get_foreign_key_map` + `fkDisplayRegistry` (`packages/database/src/audit.config.ts`, handler in `packages/jobs/src/inngest/functions/events/{audit,fk-snapshots}.ts`). Found while fixing "audit log shows location id instead of name" (2026-08).

**Problem:** Three distinct shapes made raw ids reach the UI. (1) `get_foreign_key_map` reads `pg_constraint`, so reference columns **without a real FK constraint** are invisible to it — no snapshot no matter what the registry says. This schema has many: `salesOrder.salesPersonId`, `salesInvoice.assignee`, line-level `locationId`s on `purchaseOrderLine`/`salesOrderLine`/`salesInvoiceShipment`, `inventoryCountLine.storageUnitId`, etc. (2) Junction targets (`customerContact`/`supplierContact`, `opportunity`, `fulfillment`…) have no displayable columns of their own — the name lives one hop away (`contact.fullName`), which single-hop resolution can't reach. (3) A target table simply missing from `fkDisplayRegistry` silently degrades to the raw id — no error anywhere.

**Rule:** When adding a reference column to an audited table, either give it a real FK constraint (registry/hops then cover it automatically) or declare a per-column `snapshotFields` override on that table's audit config. For targets whose display value lives on another table, use `fkDisplayHops` (two-stage batched lookup). Resolution precedence is override > hop > registry; hops and registry must stay disjoint, and overrides must not target hop tables — both invariants are enforced by tests in `fk-snapshots.test.ts`. Snapshots are frozen at write time: config changes never backfill existing audit rows.

**Applies to:** `packages/database/src/audit.config.ts` (`fkDisplayRegistry`, `fkDisplayHops`, `snapshotFields`), `packages/jobs/src/inngest/functions/events/fk-snapshots.ts` + `audit.ts`, and any migration adding reference columns to tables listed in `auditConfig.entities`.

## An `isolation: "worktree"` subagent forks from `main`, not the parent's current branch

**Context:** Dispatching three `Agent` subagents with `isolation: "worktree"` to run `/feature` autonomously for NIST items, each told it was "forked from branch `nist-800-110-audit`" and building on code that lives ONLY on that branch (`packages/auth/src/services/auth-events.server.ts` etc., absent from `main`).

**Problem:** The worktree the Agent tool creates forks from the repo's default (`main`), NOT the parent session's current branch HEAD. A subagent that trusts the "you are on <branch>" framing is actually on a `main`-based commit missing all the branch's work. Two of three agents noticed (the referenced file was absent at HEAD) and re-branched from `origin/nist-800-110-audit`; the third did not — it **vendored a duplicate** of the branch-only `auth-events.server.ts`, and its PR branch dragged in ~70 files of `main`-only work plus the duplicate, so the PR was unmergeable and had to be rebuilt by hand.

**Rule:** When an agent's task depends on unmerged branch code, do not assume the worktree is based on that branch. In the dispatch prompt, require the agent to `git fetch origin` and explicitly branch from `origin/<intended-base>`, set the PR `--base` to it, and **verify the base before writing code** (confirm a known branch-only file exists at HEAD; STOP and report if it is missing rather than recreating/vendoring it). When a delivered branch looks wrong, check `git merge-base <base> <deliveredBranch>` against the base HEAD — a merge-base far back means it forked from the wrong place. To salvage a mis-based branch, extract only its real new files onto a fresh branch off the correct base (don't cherry-pick its whole divergent history).

**Applies to:** any `Agent` call with `isolation: "worktree"` whose work builds on unmerged branch state; PR base selection for agent-produced branches.

## Resolve merge conflicts in GENERATED files by regenerating, not by hand-editing the markers

**Context:** Merging `origin/main` into a long-lived feature branch where both sides had added migrations. The only conflicts were generated outputs: `packages/database/src/types.ts` + `functions/lib/types.ts` (one FK-relationship hunk each) and `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`.

**Problem:** Git auto-combined most of the generated output but left one view's relationship list conflicting. Hand-picking a side drops one branch's relationships (the view genuinely has all the columns); union-merging risks duplicating entries; either way the result may not match what the real generator emits from the COMBINED schema. Generated files are outputs, not source — resolving their conflict markers by hand is guessing at the generator.

**Rule:** For a conflict in a generated file, regenerate instead of editing markers. For `@carbon/database` types: start the postgres container, apply BOTH branches' pending migrations (`pnpm db:migrate`), then `pnpm run generate:types` — it overwrites `types.ts` + `functions/lib/types.ts` from the live schema, connects via `SUPABASE_DB_URL`, and needs only postgres (not the full stack; the chained swagger step needs PostgREST and can fail harmlessly). `git add` the regenerated files to resolve. For build-time artifacts that regenerate on `pnpm dev`/build (`swagger-docs-schema.ts`, `tool-metadata.json`), take the superset side (usually `main`'s) as a placeholder — it self-corrects on next build. `generate:types` FK ordering is non-deterministic, so ignore ordering-only churn afterward (see the turbo-regen lesson above). Applying pending migrations forward is NOT a DB rebuild — that is the normal path; a full reset still needs the user.

**Applies to:** merging `main` into any branch with migrations on both sides; conflicts in `packages/database/src/types.ts`, `functions/lib/types.ts`, `swagger-docs-schema.ts`, `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`, and any committed generated artifact.

## A flip/refactor must not add ledger rows to a code path that deliberately posted none

**Context:** Implementing the batch-split identity flip (spec `2026-08-04-batch-split-identity-flip.md`) via a shared `buildBatchSplitRecords` builder that emits a 2-row net-zero `Batch Split` `itemLedger` pair. Wired it into all five split writers uniformly, including `post-shipment`'s Purchase-Order-sourced block.

**Problem:** The pre-flip `post-shipment` PO block (subcontract / outside-processing shipments against a PO) wrote split **genealogy only** — `trackedEntity` + `trackedActivity` + output rows — and posted **zero** `itemLedger` rows, unlike the SO block which posts a `Sales Shipment` negative-adjustment the split pair complements. Mechanically wiring the builder's ledger inserts into the PO block introduced a −q on the parent that nothing in that path offsets, changing inventory behavior for subcontract shipments with unclear valuation consequences. Own-file `deno check` and typecheck stay green (it compiles fine), so only reading the ORIGINAL of each branch caught it. Self-review found it; the browser e2e never would have (no shippable PO fixture).

**Rule:** When applying a uniform transformation across N sibling branches, diff each branch against its own pre-change body — don't assume they were symmetric. A branch that posted no ledger, sent no email, fired no event before your change must still post/send/fire nothing after, unless the spec explicitly says otherwise. "It typechecks and the other four branches do it" is not evidence the fifth should. Preserve per-branch behavior; the flip's mandate was which id departs, not to newly introduce inventory movements.

**Applies to:** `packages/database/supabase/functions/post-shipment/index.ts` (PO vs SO split blocks); any refactor threading a shared record-builder through multiple writers (`post-*`, `issue`, sync handlers).

## Carbon journal amounts are natural-balance-signed, not debit-signed

- **Context:** Wiring Rillet journal posting sync; first live push of a real
  `Purchase Receipt` journal failed UNBALANCED_JOURNAL (+300/+300).
- **Problem:** The accounting sync engine (preflight balance check, netting,
  consolidation, all provider journal mappers) assumed `journalLine.amount`
  is debit-signed (positive = debit, negative = credit, sum = 0). Carbon's
  post-* edge functions actually sign by the account's NATURAL balance
  (`credit("liability", x)` stores +x — functions/lib/utils.ts), so real
  journals balance as debits == credits, not signed-sum-zero. Also:
  Kysely/pg returns DATE columns as JS Date objects — `postingDate.slice`
  crashes; and disabled-config skip results without `localId` make the
  drain report the misleading "No sync result returned for entity".
- **Rule:** Convert to debit-signed at the fetch edge with
  `toDebitSignedAmount(account.class, amount)` (join account.class in the
  journal-line query), normalize dates with `toPostingDateString`, and
  always set `localId`/`remoteId` on every SyncResult, including early
  skips. Never trust the debit-signed assumption against live journal data
  without checking the edge functions' credit()/debit() helpers.
- **Applies to:** packages/ee/src/accounting (journal syncers, posting
  preflight, consolidation), any new accounting provider's journal mapper.

## A conformance check is only as good as its source glob — route modules are server AND client in one file

**Context:** The timezone audit (branch `sid/timezone-tz-audit`, PR #1339) added the `no-local-timezone` conformance check to ban process-timezone day derivation in server code. Self-review then found 26 surviving violations in route files, plus more in files the check DID scan using idioms it didn't match.

**Problem:** Two independent under-coverages compounded. (1) The check's source globs (`sources/server-files.ts`) listed services, jobs, and edge functions but not `apps/*/app/routes` — and collected only `.ts`, never `.tsx` — so route loaders/actions (server code!) were never scanned. (2) The banned-pattern list encoded only the idioms already found (`getLocalTimeZone(`, UTC-slicing), not the bug class — `new Date().getDay()` shift rosters and `setHours(0,0,0,0)` week boundaries sailed through in files that WERE scanned. Naively adding the route glob would over-flag: a route module's default export, `clientLoader`/`clientAction`, and hooks run in the browser where the local timezone is correct. Masking IN loader/action bodies also failed — module-level helpers a loader calls (e.g. `getExpiredItemIds`) are server code outside those bodies.

**Rule:** When authoring a conformance check, verify the checker actually loads every file class the rule applies to (run it, count the files, grep one known-bad file into the scan). Ban the bug class, not just the instances you found — then run the widened pattern over the full source set and fix or baseline everything it surfaces before landing. For React Router route modules, path-level globs are the wrong granularity: mask OUT the client regions by declaration shape (`maskClientCode` blanks default export / `clientLoader` / `clientAction` / PascalCase and `use*` declarations) so server helpers stay covered; masking IN named exports under-covers. And when masking by line shape, the region CLOSER is as bug-prone as the opener: a `)` closer that also matches a multi-line signature's `) {` line ends the region before the body and un-masks client code (only statement-terminating `)`/`);` lines close a region), while an expression-bodied one-liner (`const X = () => null;`) must never OPEN a region at all — pin both shapes as regression tests.

**Applies to:** `packages/checks/src/sources/server-files.ts` + `conformance/no-local-timezone.ts`; any new `SERVER_CHECKS` rule; any lint/conformance gate keyed on file paths over `apps/*/app/routes`.

## A per-request memo keyed on the `Request` object never hits — React Router doesn't share one across loaders

**Context:** Perf work on `sid/perf-audit-hot-paths` (2026-08). Every matched route calls `requirePermissions` independently, so a detail page did one Redis GET for permission claims and one `createClient()` per loader. The obvious fix is to memoize per request.

**Problem:** The first attempt was a `WeakMap<Request, …>` — safe-looking, self-evicting, zero call-site changes, and it passed typecheck plus six unit tests asserting "same Request → same value, different Request → different value". It also did nothing: measured with `redis-cli monitor`, claims lookups on a deep page were **4 both with and without it**, because React Router does not hand the same `Request` instance to every matched loader. The unit tests were green precisely because they constructed the shared-Request case the runtime never produces. The working mechanism is AsyncLocalStorage holding React Router's own per-request `RouterContextProvider` (published by a root middleware) — the same pattern `requestIdMiddleware` already used via LogTape's `withContext`. That took the page from 4 lookups to 1.

**Rule:** A memo is a performance claim, and a performance claim needs a measurement, not a unit test — a test can only prove the memo behaves as written, never that its key is stable in production. Before shipping request-scoped caching, count the underlying calls end-to-end (redis `MONITOR`, `pg_stat_statements`, a temporary counter) with the change toggled off and on. Reach for ALS-over-`context` rather than keying on `Request`. And note the corollary: memoizing **database state** must be gated to GET/HEAD/OPTIONS (`oncePerRead`), because React Router runs an action and its loader revalidation in a single request — an ungated memo there serves pre-write data, which for permission claims means a gate passing on permissions the action just revoked.

**Applies to:** `packages/logger/src/context.server.ts` (`oncePerRequest` / `oncePerRead` / `requestContextMiddleware`), `packages/auth/src/services/{auth,users}.server.ts`, and any future request-scoped cache.

## A word-boundary rename corrupts UI copy that typecheck and tests can't see

**Context:** Splitting ERP list types into `X` (full view row, for detail screens) and `XListItem` (the narrowed list select) on `sid/perf-audit-hot-paths`. Applied with a regex renaming the whole-word alias across each table component.

**Problem:** `Part`, `Material`, `Tool`, `Consumable`, `Service` are single words that appear in **user-visible strings** as well as type positions. The rename produced ``t`PartListItem ID` ``, `<Trans>Delete PartListItem</Trans>`, and a button reading "Add PartListItem" — 20 occurrences across five files. Typecheck passed, 268 unit tests passed, all ten narrowed selects returned 206 from PostgREST, and `EXPLAIN` looked right. Only loading the page caught it. (The five multi-word aliases — `PurchaseOrder`, `SalesOrder`, … — were untouched, because their display text contains a space.)

**Rule:** After any mechanical rename of an identifier that is also an English word, grep for the new name inside string literals, template literals and JSX text (``t`…` ``, `<Trans>…</Trans>`, `"…"`) before committing — and load one affected screen. Type-level green says nothing about copy. Prefer renaming with an editor's symbol-aware rename over a regex; when a regex is the only option, exclude string/JSX regions explicitly.

**Applies to:** `apps/erp/app/modules/*/ui/*/*Table.tsx`, `apps/erp/app/modules/*/types.ts`; any bulk identifier rename in files containing Lingui macros.

## A new package `exports` subpath 500s until every running dev server restarts

**Context:** Adding `@carbon/logger/context.server` and `@carbon/auth/request-scope` during the same perf work.

**Problem:** Vite resolves a package's `exports` map once at dev-server start. Adding a subpath and importing it immediately produced `"./context.server" is not exported under the conditions [...]` on every route — a hard 500 across the whole app, twice, each time looking like a code bug rather than a stale resolver. Typecheck was green throughout, since TypeScript reads the updated `package.json` directly.

**Rule:** Adding an export subpath to a workspace package is a dev-server-restart change. Either restart every running dev server as part of the change, or re-export the new module from an already-exported entry point and leave a TODO to move it at the next coordinated restart. A green typecheck does not mean the running server can resolve the import.

**Applies to:** `packages/*/package.json` `exports`, and any new `src/*.server.ts` intended for cross-package import.

## `space-x-*` gives a phantom margin when a component injects sibling nodes

**Context:** A reported layout shift — hovering any row of an ERP list table shifted every column of the whole table ~8px sideways.

**Problem:** `Hyperlink` renders `<Link prefetch="intent">`. React Router implements that by rendering `<>{anchor}{prefetchLinks}</>`, so on hover four `<link rel="prefetch">` elements appear **as siblings of the anchor** inside whatever container the caller used — here `<HStack>`. Tailwind v4's `space-x-*` compiles to `& > :not(:last-child) { margin-inline-end }`, so the instant those links mount the anchor stops being `:last-child` and gains a real 8px margin. Under `table-layout: auto` that re-lays out the column and the whole table. The links are `display: none`, which is exactly why this reads as impossible: every computed style on the `<td>` except `background-color` is unchanged, the anchor and all its children keep identical widths, and only the `<td>` and its wrapper grow. Two false leads first — the load-time column settle (237.5 → 245.1 with no hover, ~4s after load) masquerades as the same shift, and `opacity-0 → opacity-100` on the "Open" button looks like the obvious culprit but cannot move layout.

**Rule:** `space-x-*` / `space-y-*` are structural (`:not(:last-child)`) — never use them on a container whose children a component may add to at runtime; use `gap-*`, which only applies between elements that generate boxes and so ignores `display:none`. When a component renders extra DOM next to its main element (React Router prefetch links, portals, measurement nodes), isolate it in a `display: contents` wrapper so it can't perturb the caller's layout. To diagnose "impossible" width changes, diff every computed property between states and count child nodes — a node-count delta with no style delta means injected DOM, not CSS.

**Applies to:** `apps/erp/app/components/Hyperlink.tsx`; `packages/react/src/{HStack,VStack}.tsx` (still `space-x-*`/`space-y-*`, ~2,500 call sites); any `<Link prefetch>` placed directly inside a `space-*` container.

## A list-query benchmark that omits the ORDER BY measures a query the app never runs

**Context:** Lateralizing the `salesOrders`/`purchaseOrders` list views on `sid/perf-audit-hot-paths`. The rewrite benchmarked as a ~9x win and shipped; re-measuring later against the real endpoint showed page 1 taking **41.6 seconds**.

**Problem:** The benchmark ran `SELECT ... FROM "salesOrders" WHERE "companyId" = $1 LIMIT 100` — no `ORDER BY`. Every one of these endpoints applies a fixed default sort (`setGenericQueryFilters(query, args, [{ column: "createdAt", ascending: false }])`). That one clause inverts the result: with no sort the planner pushes `LIMIT 100` below the lateral join so the aggregate runs ~100 times (10.6 ms vs 91.3 ms for the bulk form — the win that was measured); with the sort and no index supplying its order, every row must be produced before the limit applies, so the aggregate runs once per order in the company — 10,000 times, each re-scanning `item` under a non-indexable RLS policy. Two other things hid it: the seeded tables had **never been analyzed** (`last_analyze` and `last_autoanalyze` both NULL, `n_live_tup` 0), so plan choice was unstable; and the stated rationale — "the bulk form aggregates every tenant's lines" — was simply false, since `salesOrderLine` has RLS and the view is `SECURITY INVOKER`, so it was always company-scoped.

**Rule:** Benchmark the query the service actually builds — copy the projection, the `ORDER BY` from `setGenericQueryFilters`, and the `LIMIT/OFFSET`, not a simplified `SELECT * ... LIMIT n`. Run `ANALYZE` before trusting any timing on seeded data, and check `pg_stat_user_tables.last_analyze` first. When a rewrite's premise is "this touches rows it shouldn't", verify it against `pg_policies` before optimizing — RLS may already be doing it. A LATERAL is only a win when the limit can be pushed below the join, which needs an index supplying the sort; check the plan for `Seq Scan ... loops=<number of outer rows>`, which is the signature of a per-row aggregate that was meant to run per page.

**Applies to:** `packages/database/supabase/migrations/20260807011742_lateralize-order-list-views.sql`, `20260806235710_perf-list-query-indexes.sql`, `apps/erp/app/utils/query.ts` (`setGenericQueryFilters`), and any future list-view or RLS-policy performance work.

## Inngest `concurrency: { limit: 0 }` is no capacity, not unlimited

**Context:** Moving webhooks onto the event system. The `WEBHOOK` handler had never actually run — webhooks went through 39 pg_net triggers, so the handler was dead code. Once a subscription made it live, every delivery sat in `QUEUED` forever and nothing reached the endpoint.

**Problem:** `webhook.ts` declared `concurrency: { limit: 0, key: "<table>-<recordId>" }`. `limit: 0` reads like "unlimited" and is almost certainly what the author meant, but Inngest treats it as zero capacity: runs are accepted, grouped by key, and never scheduled. The failure is silent and looks like the event never fired — the drainer completes, the queue empties, `pgmq` shows nothing pending, and only the run list reveals runs parked in `QUEUED` while sibling handlers from the same drain show `COMPLETED`. A controlled test confirmed it: three runs stuck at `limit: 0`, and changing only that value to `1` released them. Two more instances existed — `workflow.ts` (a stub, latent) and `reschedule-job.ts` (`schedule-job`, live, called from `production.server.ts` and `production.service.ts`).

**Rule:** Inngest `concurrency.limit` must be `>= 1`; to mean "unlimited", omit the `concurrency` block entirely. With a `key`, `limit: 1` is the usual intent — serialize per record/company. Enforced by the `no-zero-concurrency` conformance check in `@carbon/checks`. More generally: a handler with zero subscriptions is dead code whose config is never exercised, so any bug in it surfaces only when something makes it live — when wiring an existing-but-unused handler, fire it end-to-end rather than trusting that it worked before.

**Applies to:** `packages/jobs/src/inngest/**` `createFunction` options; `packages/checks/src/conformance/no-zero-concurrency.ts`.

## Generated DB types must come from a migration-built database, never a restored snapshot

**Context:** `crbn restore` ends with `pnpm db:types`. Those regenerated types were then swept into a commit by `git add -A`, putting 194 lines of unrelated churn into a webhooks/RLS PR.

**Problem:** A production snapshot carries whatever the source environment accumulated outside the migration stream, so types generated from it describe *that* database rather than the schema the migrations define. The diff added a `v_readable_id` relation absent from `main` — not a schema object at all, but a plpgsql local (`v_readable_id TEXT;` … `SELECT … INTO v_readable_id, v_company_id`) that ran somewhere in a plain-SQL context, where `SELECT … INTO` is CREATE-TABLE-AS. An accidental artifact table exists in the snapshot, and regenerating baked it into the repo's public type surface, alongside `procedureStep`→`procedureAttribute` FK-name churn.

**Rule:** Never commit `packages/database/src/types.ts` (or `supabase/functions/lib/types.ts`) generated after a `crbn restore` — regenerate against a migration-built database first. `crbn restore` now warns about this. Stage generated types explicitly rather than with `git add -A`, and diff them before committing: any relation appearing that no migration defines is drift from the source environment, not a schema change. Separately, `SELECT … INTO <name>` in a SQL (non-plpgsql) context silently creates a table — a real hazard when copying plpgsql bodies into migrations.

**Applies to:** `packages/dev/src/commands/restore.ts`, `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`.

## Kysely returns NUMERIC as a string; supabase-js returns it as a number

**Context:** `upsertQuoteLinePrices` was converted from supabase-js to a Kysely transaction so its delete + reinsert would roll back as a unit. The conversion typechecked, and the shipped result silently stopped preserving `shippingCost`, `discountPercent` and `leadTime` on every markup change.

**Problem:** The function keys the snapshot of existing rows by quantity and looks each one up while building the reinsert. Through PostgREST a `NUMERIC` column arrives as a JS `number`, so `pricesByQuantity[10]` matched. Through node-postgres — which Kysely uses — the same column arrives as the string `"10.00000"`, because pg does not parse `NUMERIC` (oid 1700) to float and this repo sets no `setTypeParser` anywhere. Every `Map.get(10)` therefore missed, `existing` was always `undefined`, and each preserved field fell back to the caller's value: shipping to the column default `0`, discount and lead time to the zeros the recalculate route passes. The generated types say `number` on both paths, so `tsgo` cannot see it — the mismatch exists only at runtime.

**Rule (updated by the numeric-precision standard):** NUMERIC (oid 1700) now decodes to a JS number in BOTH runtimes — node-postgres via `setTypeParser` and deno-postgres via `controls.decoders`, registered once in `lib/postgres/index.ts` — so runtime finally matches the generated types for numerics. The caution below still applies to `BIGINT` and float8 (still strings), to any pool NOT built through the shared factory, and as history for why `Number(...)` coercions litter Kysely call sites (they are now harmless no-ops). Original rule: when porting a query from supabase-js to Kysely, treat every `NUMERIC`/`DECIMAL`/`BIGINT` read as a **string** regardless of what the generated type claims. Normalize with `Number(...)` only where the value has to be a number — an object/`Map` key, a `===` comparison, arithmetic — and only for bounded fields like a quantity or a precision. Do **not** normalize a whole row for tidiness: `Number()` on a `BIGINT` or a wide `NUMERIC` silently loses precision past `Number.MAX_SAFE_INTEGER`, and money is exactly where that matters. Writing values back untouched is both safe and preferable — pg accepts the canonical string for a numeric param, and passing it straight through preserves the stored value exactly. More generally: a client swap can change runtime value types without changing a single TypeScript type, so a typecheck is not evidence that a port behaves identically — exercise it against a real database.

**Applies to:** `apps/erp/app/modules/sales/sales.service.ts` (`upsertQuoteLinePrices`), any `Kysely<KyselyDatabase>` service in `apps/erp/app/modules/**` or `packages/database/supabase/functions/**`, and the `getPostgresClient` pool in `packages/database/supabase/functions/lib/postgres/index.ts`.

## A VERIFY-flagged provider endpoint in a cron loop is an outage, not a TODO

**Context:** The Rillet AP payment pull assumed an org-wide `GET /bill-payments` feed mirroring `/invoice-payments`. The method carried a VERIFY comment ("assumed to mirror… not confirmed") and even named its own fallback, but shipped unguarded inside `listChanges`. The endpoint does not exist (404).

**Problem:** Every `accounting-pull-sweep` run threw at the AP step, killing the whole Rillet pull — including the AR invoice-payment changes collected earlier in the same call — every 30 minutes, silently. Payments recorded in Rillet never flowed back to Carbon, so a bill paid remotely stayed open locally, got paid a second time in Carbon, and the outbound push then failed forever on Rillet's over-pay guard. One unverified assumption at the bottom of a sweep became a permanent, compounding data gap that surfaced two layers away from its cause.

**Rule:** An API call that only runs inside a cron/sweep is exercised for the first time in production — verify VERIFY-flagged endpoints against the live sandbox *before* wiring them into a loop (one curl answers it), and never let one entity family's listing failure discard another family's already-collected changes. When an assumed endpoint is missing, compose from verified ones instead: Rillet AP payments = `GET /bills?updated.gt` (payment activity bumps the bill's `updated_at`) + `GET /bills/{id}/payments` per changed bill.

**Applies to:** `packages/ee/src/accounting/providers/rillet/provider.ts` (`listChanges`, `listBillPaymentsUpdatedSince`), any `SupportsIncrementalPull.listChanges` implementation, VERIFY-flagged calls anywhere under `packages/ee/src/accounting/providers/**`.
## react-aria's blur commit makes the input formatter part of arithmetic

**Context:** The numeric-precision standard's motivating bug — a user typed 6.25% tax, saved, reopened, and read 6.22%.

**Problem:** react-aria NumberField commits on blur by running `parse(format(value))` — whatever `formatOptions` the input carries re-rounds the committed number. A currency-formatted amount input rounds to cents on blur; the old bidirectional tax pair (amount edit → percent = amount/subtotal, percent edit → amount = subtotal×percent) then overwrote the typed 6.25% with 0.56/9.00 = 6.22%. Nothing in zod, the column type, or the service was wrong — the INPUT FORMATTER did the rounding, and the coupling propagated it.

**Rule:** Editable numeric inputs must use the named `INPUT_FORMAT.*` kinds from `@carbon/utils` (rate max 3 percent-digits, quantity max 5, money/price at the currency's decimals) so the blur round-trip preserves the stored scale. **Round a derived value to the scale of the field that will hold it BEFORE putting it there** — that is the actual fix. An unrounded 0.5625 in a cents-formatted input is re-committed as 0.56 on blur, which registers as a genuine change and feeds back through any coupling; a value derived through `applyRate` at the currency's decimals commits identically and triggers nothing. With that in place a value pair can safely stay coupled in both directions (`TaxFields` does, so the stored pair is always consistent), accepting that a rate derived back from an amount is limited by the amount's scale. When an input's digits look like a display preference, remember they are arithmetic on the persisted value.

**Applies to:** every `formatOptions` on an editable `NumberField`/`NumberControlled`/`EditableNumberCell`; `apps/erp/app/components/Form/TaxFields.tsx`; `.claude/rules/numeric-precision.md`; the `no-inline-fraction-digits` conformance check.
## Postgres transition tables are visible ONLY to the function the trigger invokes directly

**Context:** The `itemStockQuantities` aggregate needed a statement-level handler on `itemLedger` so a bulk posting is one upsert instead of N. The event system already builds statement-level triggers (`trg_event_async_*` with `REFERENCING NEW TABLE AS batched_new`), so the obvious move was to have `dispatch_event_batch()` forward to a custom function.

**Problem:** A nested call cannot see the transition tables. A plain function called from the trigger function fails with `relation "batched_new" does not exist` — and this holds for dynamic SQL too (`EXECUTE 'SELECT count(*) FROM batched_new'` fails identically), because the ephemeral named relation lives in the trigger function's own query environment and is not propagated. The only ways to hand a batch onward are materializing it into a temp table per statement (real cost on a hot write path) or not nesting at all. Separately, `dispatch_event_batch()` early-returns when a table has no active subscription and when `app.sync_in_progress` is set — both correct for queueing, fatal for an aggregate that must always be maintained.

**Rule:** A function that needs `batched_new`/`batched_old` must be attached as the trigger's own function. Use `attach_statement_handler(table, functions[])` (`20260812002453`), the statement-level sibling of the row-level interceptors; it does not enqueue to PGMQ. Handlers are attached for INSERT/UPDATE/DELETE and must branch on `TG_OP` — only `batched_new` exists on INSERT, only `batched_old` on DELETE (PL/pgSQL plans lazily, so an unexecuted branch never resolves its missing table). Note also that adding a defaulted parameter to `attach_event_trigger` is a trap: two overloads are live, and a third with defaults makes existing 2-arg calls ambiguous.

**Applies to:** `packages/database/supabase/migrations/20260812002453_event-system-statement-handlers.sql`, `.claude/rules/event-system.md`, any statement-level trigger work under `packages/database/supabase/migrations/`.

## Enumerate the full ON DELETE graph before writing a data-deleting migration

**Context:** A migration deleted 50 `jobMaterial` rows where a job listed its own output item as a material. A dry run "passed": it completed, and `productionQuantity` was verified unchanged at 4,566 rows.

**Problem:** The verification only covered the one child table that happens to be `NO ACTION`. `jobMaterial → jobMakeMethod → jobOperation` cascades into **six** further tables — `productionEvent` (labor/time), `jobOperationTool`, `jobOperationStep`, `jobOperationParameter`, `rework`, `nonConformanceJobOperation` — all `CASCADE`, all silent. `productionQuantity` was noticed precisely because `NO ACTION` raises an error; the destructive edges said nothing. Comparing the restored database against the untouched backup showed `productionEvent` had gone 3,159 → 3,158: one real customer labor record destroyed by a migration that appeared to succeed.

**Rule:** Before any `DELETE` in a migration, query `pg_constraint` for `confrelid` of every table the delete can reach and read `confdeltype` for each edge (`c` = CASCADE, `r`/`a` = RESTRICT/NO ACTION, `n` = SET NULL). The `RESTRICT` edges are the ones that will teach you by failing; the `CASCADE` edges are where the data actually goes. Design the cleanup so the cascade cannot reach anything historical — here, detaching (`parentMaterialId = NULL`) every subtree containing ANY `jobOperation`, so only empty method copies are collected. Verify with a probe that builds the exact structure, runs the real delete statement, and asserts the child rows survive — and where a snapshot exists, diff the affected table's count against the backup rather than trusting that the statement completed.

**Applies to:** `packages/database/supabase/migrations/20260812032423_job-material-self-reference-guard.sql`, any migration under `packages/database/supabase/migrations/` containing `DELETE FROM`.

## `max_rows` is enforced in production but not by the local dev stack

**Context:** MRP's Phase-1 loads used bare `.select("*")` with no pagination, and had done so since the function was written. Every local test passed.

**Problem:** `packages/database/supabase/config.toml` sets `max_rows = 1000`, so PostgREST truncates responses in production. The crbn dev stack runs its own `postgrest` container without `PGRST_DB_MAX_ROWS`, so locally the same query returns everything — verified: a view with 2,497 rows returned all 2,497 locally. Two production tenants exceeded the cap on `openJobMaterialLines` (2,497 and 1,495 rows) and a third on `demandActual` (9,391), so MRP silently planned on truncated demand and its zeroing pass missed stale actuals. The bug is structurally invisible to local testing.

**Rule:** Any PostgREST read that can exceed 1000 rows must paginate — `fetchAllFromTable`/`fetchAllRecords` from `@carbon/database` in app code, `fetchAll` from `supabase/functions/lib/fetch-all.ts` in edge functions — and must carry a stable `.order()` so pages don't shift between requests. Do not conclude "it returns everything" from a local run; check the row count against `max_rows` in `config.toml` instead.

**Applies to:** `packages/database/supabase/functions/mrp/index.ts`, `packages/database/supabase/functions/lib/fetch-all.ts`, `packages/database/supabase/config.toml`, any `.select()` in `packages/database/supabase/functions/**` or `apps/erp/app/modules/**`.

## `sum(DISTINCT expr)` is not a fan-out dedup — it collapses equal values from different rows

**Context:** The `salesOrders` view aggregated line totals in a lateral that also LEFT JOINs `job` (one line → many jobs), and used `sum(DISTINCT <line total>)` to cancel the join fan-out. An order with two different lines that compute to the same amount (e.g. two items at 10 × $50 each) counted that amount once, understating the total on the list page, the dashboard KPI chart, and the sales funnel — while the detail page and PDF (app-side plain sums) were correct. Dozens of real orders were affected.

**Problem:** `DISTINCT` inside an aggregate dedupes by VALUE, not by source row. It cancels duplication from a join fan-out only as long as no two *distinct* rows produce the same value — for money amounts (repeated items, same qty × price) that collision is routine. The failure is silent and data-dependent: the view verifies "byte-identical" against its predecessor because the predecessor had the same bug.

**Rule:** Never use `sum(DISTINCT ...)`/`count(DISTINCT ...)`-style aggregates to undo join fan-out. Compute the aggregate in its own lateral/subquery over just the table being summed (no fan-out ⇒ plain `sum()`), and keep the fanned join in a separate lateral for the aggregates that need it. When reviewing a view, treat any `agg(DISTINCT ...)` over a joined row set as a probable value-collapse bug. Fixed in `20260812211507_fix-sales-order-total-duplicate-line-amounts.sql`.

**Applies to:** `packages/database/supabase/migrations/` views aggregating over joins (`salesOrders`, `purchaseOrders`, quotes/invoices list views); any SQL review touching `sum(DISTINCT`.

## A globally-unique primary key means a fixed id literal collides across companies

**Context:** The onboarding demo dataset hard-coded UUID literals as `externalLink.id` in two places so the public share URLs (`/share/quote/:id`, `/share/supplier-quote/:id`) would be stable for documentation screenshots. Seeding the first company worked; the second one onto the same database died with `duplicate key value violates unique constraint "externalLinks_pkey"`.

**Problem:** Almost every Carbon table has the composite PK `("id","companyId")`, which makes a repeated `id` harmless across tenants — so a fixed literal *looks* safe by analogy. But a handful of tables are keyed on `id` alone: `externalLink` (`PRIMARY KEY ("id")`, `20241030005037_external-links.sql`) and `period` (`PRIMARY KEY ("id")`, no `companyId` column at all). For those, a literal is a database-wide singleton. The failure only appears on the *second* company, so it passes every single-company test and first surfaces in production or in a shared dev database.

**Rule:** Never write a literal primary key in seed/fixture code — let the column's `id()`/`xid()` default mint it and read the value back (`insertId`). Before assuming a repeated id is tenant-safe, check the actual `PRIMARY KEY` in the migration, not the table-template convention. For a global table with no unique key to conflict against (`period`), a read-then-insert also needs `pg_advisory_xact_lock` or a unique index — two companies seeding concurrently will otherwise both insert, and the duplicates are visible to every tenant.

**Applies to:** `packages/database/src/datasets/tiers/**`; any SQL/TS fixture that writes `externalLink`, `period`, or another `PRIMARY KEY ("id")` table; `.claude/rules/onboarding-company-templates.md`.

## `account` is scoped by `companyGroupId`, not `companyId`

**Context:** The dataset's accounting tier picked a GL account with `SELECT id FROM account WHERE class = 'Asset' ORDER BY number LIMIT 1` and posted the seeded journal lines against it. The tiers run on a raw `pg` client, which bypasses RLS entirely.

**Problem:** `account` is one of the few business tables NOT keyed by `companyId` — it belongs to the company *group*, so there is no `companyId` predicate to add by reflex and an unscoped `LIMIT 1` silently reaches across tenants. With RLS off there is nothing else stopping it, so one company's journal lines can be posted to another tenant's chart of accounts. Adding `AND "companyId" = $1` would simply have failed with `column "companyId" does not exist`, which is what makes the omission easy to leave in.

**Rule:** In any service-role or Kysely path, confirm which column actually scopes the table before writing the predicate — `companyId` for most, `companyGroupId` for `account` and its children. A `LIMIT 1` with no tenancy predicate in RLS-bypassing code is a cross-tenant bug even when it "works" locally, because a single-tenant dev database cannot show it.

**Applies to:** `packages/database/src/datasets/tiers/09-accounting.ts`; any `account` lookup in `packages/jobs/**`, `supabase/functions/**`, or a Kysely transaction.
## Appending SQL to an already-applied migration silently does nothing

**Context:** A migration adding `companySettings.requireMfa` was written and applied. Later, a `users_with_verified_mfa` RPC was appended to that SAME file and `pnpm db:migrate` was re-run. The function was never created. The employees page then showed "Not set up" for every user — including one with a verified factor — because the missing RPC returned an error that the loader discarded as an empty result.

**Problem:** Supabase tracks applied migrations by FILENAME. Once a file has run it is never re-read, so statements appended to it are invisible on every existing database while still applying to a fresh one. The two diverge silently, and there is no error at migrate time to notice.

**Rule:** Never append to a migration file that may already have been applied — a file is immutable the moment it runs anywhere. New statements go in a NEW timestamped file, even a one-line `CREATE OR REPLACE`. Corollary: a migration that adds an RPC also needs a PostgREST schema reload (`NOTIFY pgrst, 'reload schema'`) or the function stays invisible to the app; and a service call whose failure is indistinguishable from an empty result must check `error` explicitly rather than `data ?? []`.

**Applies to:** `packages/database/supabase/migrations/**`, any `client.rpc(...)` call site.

## `form.submit()` bypasses React Router; `ValidatedForm` needs a real submitter

**Context:** `@carbon/form`'s `InputOTP` auto-submits when the last digit is typed, using `form.submit()`. On the `/mfa` and `/verify` screens the error `<Alert>` reading `fetcher.data` could therefore never render — wrong codes produced no feedback at all. Switching to a bare `form.requestSubmit()` then made the form do nothing whatsoever.

**Problem:** Two separate traps. `HTMLFormElement.submit()` does not fire the submit event, so React Router never intercepts it and `fetcher.data` stays permanently undefined — the request goes out as a raw document POST. But `requestSubmit()` with NO argument leaves `nativeEvent.submitter` null, and `ValidatedForm.handleSubmit` early-returns unless `submitter?.form === target` — so it silently does nothing.

**Rule:** Programmatic submits inside a `ValidatedForm` must pass a submitter: `form.requestSubmit(form.querySelector('button[type="submit"]'))`, which means the form needs a real submit button (good for accessibility anyway). Never use `form.submit()` in a React Router app. When a form renders errors from `fetcher.data`, verify the submit path actually reaches the fetcher — an unreachable error branch looks identical to "no errors happen".

**Applies to:** `packages/form/src/components/InputOTP.tsx`, `packages/form/src/ValidatedForm.tsx`, any auto-submitting form field.

## Dating a synthetic-entity journal with company_today() drops it out of the "as of" report window

**Context:** Intercompany elimination journals post to a synthetic "elimination entity" company (no user membership, no location). `generateEliminationEntries` dated them `company_today(elimination_entity)`. Because the elimination entity has no location, `company_today` fell back to UTC — and on an evening-Pacific boundary UTC had already rolled to the next day. The eliminations posted on Aug 18 while the invoices they eliminate posted Aug 17. The consolidated balance sheet ("Aug 2026 to date", cutoff = today = Aug 17) then showed Inter-Company Payables/Receivables = 100 (un-eliminated), while the account drill-down ("all time") correctly netted to 0 — a confusing split where the row and its own drill-down disagree.

**Problem:** A consolidation adjustment must fall in the SAME reporting period/date window as the transactions it adjusts. Deriving its date from a synthetic entity's own timezone (UTC fallback) is unmoored from the operating companies' business calendar and drifts a day — or a MONTH at a month-end boundary, which would misfile the whole adjustment.

**Rule:** Date a derived/adjusting journal (elimination, allocation, reversal) to the business date of the source transactions it references — e.g. `MAX(sourceJournal.postingDate)` — not to `company_today()` of a synthetic or parent entity that may resolve to a different day. Date a reversal to its original journal's `postingDate` so the two net in one window. When a balance-sheet ROW and its drill-down "Closing" disagree, suspect an out-of-window posting date, not a summing/RLS bug. Fixed in `20260817122328_intercompany-revenue-cogs-elimination.sql`.

**Applies to:** `generateEliminationEntries` and any DB function posting to `isEliminationEntity` companies; any consolidation/allocation/reversal journal; `company_today()` callers where the company may lack a location.

## Consolidation eliminations must allocate per transaction, not per company pair

**Context:** `generateEliminationEntries` looped over company PAIRS (LEAST/GREATEST of the two companies), summed all intragroup revenue/COGS across the pair into one margin, and split the unrealized-profit writedown across the buyer capitalization lines proportional to captured value. A deterministic SQL test harness seeded two trades between the same pair with different margins capitalizing to different accounts (Machinery margin 40, another asset margin 10) and asserted each asset landed at its own group cost — it did not (both drifted to a proportional 75).

**Problem:** Pair-level aggregation preserves the TOTAL (net income and total assets stay correct) but mis-allocates the writedown ACROSS accounts when trades in the pair have different margins. Two companies trade repeatedly in a real ERP, so this is a normal case, not a corner. It was invisible in single-trade tests and only surfaced when regenerate re-matched a second trade into the same pair.

**Rule:** Eliminate/allocate at the grain of the TRANSACTION (the matched seller↔buyer document), not the company pair. Matching links the two sides via `targetJournalLineId` = the other side's `sourceJournalLineId`; use that to pull each trade's own revenue/COGS (seller side) and capitalization (buyer side) and write each asset down by ITS margin. Any consolidation adjustment that aggregates then re-splits proportionally is suspect — prove per-item allocation with a multi-trade, mixed-margin, mixed-account test. The harness (`packages/database/supabase/tests/intercompany-elimination.test.sql`) pins this.

**Applies to:** `generateEliminationEntries`; any margin/cost allocation that groups by counterparty rather than by document.

## Batched PostgREST `.in()` with hundreds of ids blows the gateway URL limit — use Kysely for big id-list reads in edge functions

**Context:** Fixing the N+1 traversal in `get-method`'s `itemToJob` by prefetching `itemReplenishment` for a whole method tree (260 item ids) with `client.from(...).in("itemId", ids)` chunked at 200 ids per request.

**Problem:** PostgREST encodes `.in()` filters in the query string. 200 UUID-length ids ≈ 8KB of URL, which exceeded the local gateway's request-line limit — the request failed outright, the prefetch threw, and every job created for a large-BOM item silently landed with an empty BOM (the caller logs the invoke error and continues). A chunk size that works in tests fails on the tenant with the most data.

**Rule:** In edge functions, batch reads keyed by a large id list go through the Kysely `db` handle (bind parameters, no URL cap) whenever no PostgREST embed is needed. If an embed forces PostgREST, chunk conservatively (≤50 ids) and include `res.error.message` in the thrown error so the failure names its cause. Never swallow a prefetch error into a bare string with no detail.

**Applies to:** `packages/database/supabase/functions/**` batch reads; any `.in(...)` over tree-collected or list-collected ids.
## Browser code must import `@carbon/documents/utils`, never `@carbon/documents/pdf`

**Context:** Adding a shared `getQuoteDisplayId` / `getPurchaseOrderDisplayId` helper for showing the revision suffix on documents. The natural home looked like the `./pdf` barrel, which already re-exported it for the server-side PDF routes.

**Problem:** `./pdf` is a barrel over every `@react-pdf/renderer` document component. A route `loader`/`action` can import from it safely — React Router strips server-only exports and tree-shakes the rest — but a **client-rendered component** cannot: the `/share/**` quote page and the ERP UI would pull the entire react-pdf graph into the browser bundle for a five-line string helper. The existing convention confirms this: ERP client components only ever import `@carbon/documents/template`, never `/pdf`.

**Rule:** Pure display helpers shared by server and browser belong in `packages/documents/src/utils/` and are exposed through the `./utils` export (type-only deps). Import them from `@carbon/documents/utils` in any component that renders in the browser. `src/utils/index.ts` is an explicit re-export list, not `export *` — the per-document util files each define their own `getLineDescription`, so a wildcard barrel collides.

**Applies to:** `packages/documents/package.json` exports, `packages/documents/src/utils/index.ts`, any `@carbon/documents` import inside `apps/erp/app/modules/**/ui/**` or `apps/erp/app/routes/share+/**`.

## A new row reusing a readable id must qualify it — `externalLink` is UNIQUE per document

**Context:** "Create Quote Revision" failed with a generic "Failed to duplicate quote". The real error was only in the edge-runtime log: `duplicate key value violates unique constraint "externalLink_documentId_documentType_unique"`.

**Problem:** `externalLink` is `UNIQUE (documentId, documentType, companyId)` (`20250711000000_customer-portal-links.sql`). A quote revision deliberately keeps the same readable `quoteId` as its source, and `get-method`'s `quoteToQuote` branch inserted a share-link row keyed on that bare id — so every revision collided with the original's link and rolled back the whole copy transaction. Worse, `deleteQuote` deletes only the `quote` row (the FK points quote→link, so nothing cascades), leaving orphan link rows that re-collide when the same revision number is issued again.

**Rule:** Any new row that reuses an existing readable id must qualify it (`Q000001-1`), and any insert into a table whose unique key can be orphaned by a delete needs `onConflict(...).doUpdateSet(...)` rather than a bare insert. When a user-facing action reports a generic failure, read the edge-runtime container log before theorising — the route's flash message hides the Postgres error code.

**Applies to:** `packages/database/supabase/functions/get-method/index.ts` (`quoteToQuote`), `apps/erp/app/modules/sales/sales.service.ts` (`deleteQuote`), any insert into `externalLink`.
