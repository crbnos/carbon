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

## Raw-SQL item fixtures break type-specific UI — Material items need a companion `material` row keyed by readableId

**Context:** Posting-flow verification created a type-`Material` item (RM-STEEL) with a raw `INSERT INTO "item"`. Interceptors auto-created `itemCost`/`itemReplenishment`/etc., so purchasing and posting worked. Later, selecting that material on a part's BOM (`/x/part/{id}/details?materialId=…`) crashed the whole page with "Not Found".

**Problem:** Type-specific detail RPCs join companion tables the interceptors do NOT create: `get_material_details` requires a `material` row joined via `material."id" = item."readableId"` (readableId, not item id — all revisions share one taxonomy row). The properties route throws `404` when the RPC returns nothing, and a fetcher 404 bubbles to the route error boundary, taking down the entire details page.

**Rule:** When creating item fixtures via SQL, create the type's companion row too (`material` keyed by `readableId` for Materials; check the `get_{type}_details` RPC joins for the type). Prefer creating fixtures through the UI or service functions when the item will be used in UI flows, not just ledger posting.

**Applies to:** any psql/SQL test-fixture item creation; `get_material_details` / `get_part_details` / `get_tool_details` consumers; `apps/erp/app/routes/x+/items+/$itemId.properties.tsx`.

## Journal debit/credit is derived from account class + amount sign, not the raw sign

**Context:** Seeding a Cash sale as a journal via SQL, I used Cash (Asset) `amount = +1000` and Sales (Revenue) `amount = -1000`, assuming `+ = debit, - = credit` (which the `journal` AGENTS.md states for the *stored* value). The `journalEntries` view then reported the entry as `totalDebits = 2000, totalCredits = 0` — unbalanced — and the period-close "Trial balance in balance" auto-check (`tb-balanced`) refused the close.

**Problem:** `journalEntries.totalDebits`/`totalCredits` are computed from **account class AND amount sign**: Asset/Expense `amount>0` OR Liability/Equity/Revenue `amount<0` → debit; the mirror → credit. So a *positive* amount on a Revenue account is a **credit**, not a debit. A correctly-balanced sale is Cash (Asset) `+1000` and Sales (Revenue) `+1000` — both positive. The raw `SUM(amount)` the balance RPCs use is a separate, class-agnostic signed sum; don't conflate the two.

**Rule:** When hand-seeding `journalLine` rows, set the sign to move the account toward its natural balance: `+` increases an Asset/Expense (debit) and increases a Liability/Equity/Revenue (credit). Verify against the `journalEntries` view (`totalDebits == totalCredits` per `journalEntryId`) before relying on the data — an unbalanced entry silently blocks period close. Posted `journal`/`journalLine` rows are immutable (`journal_posted_immutable` / `journalLine_posted_immutable`); to correct seeded mistakes you must disable those triggers on the local DB (superuser), never in a migration.

**Applies to:** any SQL journal fixtures; the `journalEntries` view; the `tb-balanced` close check in `computePeriodReadiness` (`accounting.service.ts`).

## A period snapshot written at close races Locked-period postings unless the posting guard locks the period row

**Context:** `closeAccountingPeriod` writes the `accountingPeriodBalance` snapshot inside its transaction, after flipping the period to `Closed`. `check_accounting_period_open` only *rejects* postings when a period is already `Closed`; a `Locked` period still accepts them (Locked is a soft freeze for adjustments). A period only becomes Closed on COMMIT.

**Problem:** In the window between the close txn's snapshot `SELECT` and its COMMIT, a concurrent posting reads the period as still-Locked (the flip is uncommitted under READ COMMITTED), is allowed, and commits a line with `postingDate <= endDate` that the snapshot never captured. The read path's delta only adds `postingDate > endDate`, so that line is silently dropped from the optimized balance until reopen+reclose — a wrong financial figure with no error.

**Rule:** When a cache/snapshot is written inside a state-flip transaction and a concurrent writer keys off the *committed* state, make the writer take a lock that conflicts with the flip. Here: the posting guard reads the target `accountingPeriod` row `FOR SHARE` (migration `20260713235930`), which blocks behind the close's row lock — postings before the flip commit first (and land in the snapshot); postings after block, then see `Closed` and are rejected. `FOR SHARE` is shared, so normal concurrent postings don't block each other; only an in-flight close serializes them. Verify with two psql sessions + `lock_timeout`.

**Applies to:** `check_accounting_period_open`; `snapshotAccountingPeriodBalances` / `accountingPeriodBalance`; any close/snapshot-on-commit pattern.
