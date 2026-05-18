# MTO Shipment COGS Recognition

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MTO (Make-to-Order) shipment posting recognize COGS from the job by routing MTO jobs through `complete_job_to_inventory()` and removing the `continue` statements that skip GL/inventory posting in `post-shipment`.

**Architecture:** Unify MTO and MTS job completion paths so both call `complete_job_to_inventory()`. This creates cost layers in `costLedger` and itemLedger entries for the finished good. Then remove the `continue` statements in `post-shipment/index.ts` so MTO shipment lines go through the same COGS/inventory posting as regular lines.

**Tech Stack:** PostgreSQL (PL/pgSQL migrations), TypeScript (Deno edge functions)

---

### Task 1: New migration — unify `sync_finish_job_operation` for MTO and MTS

**Files:**
- Create: `packages/database/supabase/migrations/20260512120000_mto-shipment-cogs.sql`

The current `sync_finish_job_operation` trigger (defined in `20260511120000_backflush-job-materials.sql:860-935`) branches on `v_sales_order_id IS NOT NULL`. MTO jobs only call `backflush_job_materials()`, while MTS jobs call `complete_job_to_inventory()` (which internally calls `backflush_job_materials()`). We need MTO to also call `complete_job_to_inventory()`.

- [ ] **Step 1: Write the migration**

```sql
-- Unify MTO and MTS job completion: both now call complete_job_to_inventory
-- Previously, MTO jobs only called backflush_job_materials(), skipping
-- cost layer creation. This meant shipment posting had no cost layers
-- to consume for COGS.

CREATE OR REPLACE FUNCTION sync_finish_job_operation(
  p_new JSONB,
  p_old JSONB,
  p_operation TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_location_id TEXT;
  v_job_storage_unit_id TEXT;
  v_job_quantity NUMERIC;
  v_sales_order_id TEXT;
  v_quantity_complete NUMERIC;
  v_job_status TEXT;
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'status') != 'Done' OR (p_old->>'status') = 'Done' THEN RETURN; END IF;

  -- Close all open production events for this operation
  UPDATE "productionEvent"
  SET "endTime" = NOW()
  WHERE "jobOperationId" = p_new->>'id'
    AND "endTime" IS NULL;

  -- Unlock dependent operations whose dependencies are now all done
  UPDATE "jobOperation" op
  SET status = 'Ready'
  WHERE EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    WHERE dep."operationId" = op.id
      AND dep."dependsOnId" = p_new->>'id'
      AND op.status = 'Waiting'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep2
    JOIN "jobOperation" jo2 ON jo2.id = dep2."dependsOnId"
    WHERE dep2."operationId" = op.id
      AND jo2.status != 'Done'
      AND jo2.id != p_new->>'id'
  );

  -- Only complete the job if it is in an active state (has been released/started)
  SELECT status INTO v_job_status FROM "job" WHERE id = p_new->>'jobId';
  IF v_job_status NOT IN ('Ready', 'In Progress', 'Paused') THEN
    RETURN;
  END IF;

  -- If this is the last operation, mark the job as Completed
  IF is_last_job_operation(p_new->>'id') THEN
    SELECT "locationId", "storageUnitId", quantity, "salesOrderId"
    INTO v_job_location_id, v_job_storage_unit_id, v_job_quantity, v_sales_order_id
    FROM "job"
    WHERE id = p_new->>'jobId';

    v_quantity_complete := CASE
      WHEN COALESCE((p_new->>'quantityComplete')::NUMERIC, 0) = 0 THEN v_job_quantity
      ELSE (p_new->>'quantityComplete')::NUMERIC
    END;

    PERFORM complete_job_to_inventory(
      p_job_id := p_new->>'jobId',
      p_quantity_complete := v_quantity_complete,
      p_storage_unit_id := v_job_storage_unit_id,
      p_location_id := v_job_location_id,
      p_company_id := p_new->>'companyId',
      p_user_id := p_new->>'updatedBy'
    );
  END IF;
END;
$$;
```

- [ ] **Step 2: Verify migration syntax**

Run: `cd /Users/barbinbrad/Code/carbon && grep -c "CREATE OR REPLACE FUNCTION sync_finish_job_operation" packages/database/supabase/migrations/20260512120000_mto-shipment-cogs.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260512120000_mto-shipment-cogs.sql
git commit -m "feat: unify MTO/MTS job completion to both call complete_job_to_inventory

Previously MTO jobs only called backflush_job_materials(), skipping cost
layer creation in costLedger. This meant shipment posting had no cost
layers to consume for COGS recognition.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Remove `continue` in post-shipment posting flow

**Files:**
- Modify: `packages/database/supabase/functions/post-shipment/index.ts:322`

The `continue` on line 322 causes MTO shipment lines (fulfillment type "Job") to skip all downstream processing: itemLedger creation, COGS journal entries, cost layer consumption. After Task 1, MTO finished goods will have proper cost layers, so we can let them flow through the normal COGS path.

- [ ] **Step 1: Remove the `continue` statement**

In `packages/database/supabase/functions/post-shipment/index.ts`, delete line 322 (`continue;`). The job update block (lines 215-321) should still run, but then fall through to the itemLedger/COGS code below instead of skipping it.

The change is deleting this single line:
```typescript
                // BEFORE (line 322):
                continue;
```

After the closing brace of the job update block on line 321 (`}`), the code should fall through to line 325 (`const itemTrackingType = ...`).

- [ ] **Step 2: Verify the change**

Run: `grep -n "continue;" packages/database/supabase/functions/post-shipment/index.ts | head -5`

The `continue` that was on line 322 should no longer appear in the posting section (lines 210-460). There may still be a `continue` in the void section — that's Task 3.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/functions/post-shipment/index.ts
git commit -m "feat: enable COGS posting for MTO shipment lines

Remove continue statement that skipped itemLedger, COGS journal entries,
and cost layer consumption for job-fulfilled shipment lines.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Remove `continue` in post-shipment void flow

**Files:**
- Modify: `packages/database/supabase/functions/post-shipment/index.ts:1753`

The void flow has the same issue: MTO shipment lines skip inventory restoration and COGS reversal journal entries.

- [ ] **Step 1: Remove the `continue` statement in the void section**

In `packages/database/supabase/functions/post-shipment/index.ts`, delete the `continue;` on line 1753 (this line number may have shifted by -1 after Task 2). It's inside the void flow's job update block, after `jobUpdates[jobId] = { ... }` on line 1747-1751.

The change is deleting this single line:
```typescript
                // BEFORE (line 1753, or 1752 after Task 2):
                continue;
```

After removing it, the void flow will fall through to create positive adjustment itemLedger entries (restoring inventory), batch/serial tracking restoration, and COGS reversal journal entries for MTO lines.

- [ ] **Step 2: Verify the change**

Run: `grep -n "continue;" packages/database/supabase/functions/post-shipment/index.ts`

There should be no `continue` statements remaining inside either the post or void shipment line loops related to job fulfillment.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/functions/post-shipment/index.ts
git commit -m "feat: enable COGS reversal for voided MTO shipments

Remove continue statement that skipped inventory restoration and COGS
reversal journal entries for job-fulfilled shipment lines during void.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Review

After all three tasks, verify:

- [ ] `sync_finish_job_operation` no longer branches on `salesOrderId` — both MTO and MTS call `complete_job_to_inventory()`
- [ ] `complete_job_to_inventory()` calls `backflush_job_materials()` internally (line 513 of 20260511 migration), so no double-backflush
- [ ] Post-shipment posting flow: MTO lines create itemLedger entries, COGS journal entries, and consume cost layers
- [ ] Post-shipment void flow: MTO lines create reversal itemLedger entries and COGS reversal journal entries
- [ ] Job quantity tracking (quantityShipped, quantityComplete, status) still works — that code runs before the removed `continue`

## Notes

- Migration file: `packages/database/supabase/migrations/20260512120000_mto-shipment-cogs.sql`
- Edge function: `packages/database/supabase/functions/post-shipment/index.ts`
- `complete_job_to_inventory` is defined in `20260511120000_backflush-job-materials.sql:342-837`
- `backflush_job_materials` is defined in `20260511120000_backflush-job-materials.sql:1-340`
- `calculateCOGS` is at `packages/database/supabase/functions/shared/calculate-cogs.ts`

---

# MCP minimal annotation migration (2026-05-17)

Spec: `docs/superpowers/specs/2026-05-17-mcp-minimal-annotation-design.md`

Goal: shrink `mcpTool()` literal 4→2 fields; generator-derive
`description` + `paramSchema`; unify `injectAuth`+`injectInto` into one
build-verified `inject: [{param, as}]` list. ~1043 call sites, 15 modules.

Constraint: low RAM — no full builds, memory-capped scoped tsc only; no
extra subagents unless explicitly approved. Nothing committed until asked.

## Phase 1 — types + wrapper signature
- [x] `types.ts`: add `InjectBinding = { param: string; as: AuthField }`.
- [x] `types.ts`: `McpToolAnnotation` — make `description` optional,
      `paramSchema` optional; replace `injectAuth`/`injectInto` with
      `inject?: InjectBinding[]`.
- [x] `types.ts`: `McpToolMetadata` — keep resolved `description`,
      `paramSchema`, derived `auth`/injection from `inject`.
- [x] `mcpTool.ts`: update doc-comment example to the 2-field form.
- [x] Verify: scoped `tsc` on `services/mcp/*` compiles.

## Phase 2 — generator (scripts/generate-mcp-manifest.ts)
- [x] Derive `description` from fn name (de-camelCase) when literal omits
      it; if literal still has it during transition, assert equality.
- [x] Resolve `paramSchema` from the typed param per spec table
      (validator-ref / primitive / inline preserved / honest z.unknown).
      Resolve `z.infer<typeof X>` across the module import to `*.models.ts`.
- [x] Parse `inject: [{param, as}]`; back-compat read old
      `injectAuth`/`injectInto` during transition and normalize to `inject`.
- [x] BUILD-TIME HARD ERROR: every `inject[].param` ∈ argOrder; every
      `inject[].as` ∈ {companyId,userId,createdBy,updatedBy}. Fail
      generation, not warn.
- [x] Verify: run generator on `sales` only; inspect emitted manifest diff.

## Phase 3 — executor (services/mcp/executor.ts)
- [x] Build `auth`/injection plan from unified `inject` list.
- [x] Single code path: per `inject` entry, stamp into object value OR set
      primitive positional, decided by runtime value shape.
- [x] RUNTIME GUARD: throw if `inject[].param` not in argOrder.
- [x] Preserve identity-strip + defense-in-depth sweep behavior.
- [x] Verify: executor tests — identical stamped payload pre/post for
      one object-param tool (upsertSalesOrder) + one primitive tool
      (closeSalesOrder) + one old injectInto:"args" tool.

## Phase 4 — prove on `sales` module
- [x] Codemod the ~151 `sales.service.ts` call sites to 2-field form.
- [x] Regenerate manifest for sales; scoped tsc clean.
- [x] STOP — user reviews the vertical slice before rolling wider.

## Phase 5 — roll to remaining 14 modules
- [x] Apply identical codemod module-by-module (verify each before next).
- [x] account/shared/users (0 validator-typed) — confirm honest
      z.unknown() retained, not faked.

## Phase 6 — final verification
- [x] Full scoped tsc (memory-capped) clean across erp — 0 errors.
- [x] Manifest regenerated; contentHash byte-identical to baseline
      (sha256:a58a487…) — behavior 100% preserved.
- [x] AST-precise audit: 0 legacy keys in any of 1043 annotations
      (argOrder retained only for destructured-param tools that need it).
- [x] 44 MCP tests pass (services + routes + manifest).

## Review

Outcome: all 1043 mcpTool annotations across 15 modules migrated to the
minimal Option-B form. Annotation went 4 fields → typically 1–3
(`classification` always; `schema` only for real validators; `inject`
only when identity is injected; `argOrder` only for destructured params).
`description` + `z.unknown()` placeholders fully eliminated.

Behavior preservation: PROVEN. The generated manifest's contentHash and
the generated registration file are byte-identical before and after the
entire migration. No runtime behavior changed.

Phases delivered:
- P1 types + `mcpTool` signature (loosened literal, strict registration).
- P2 generator: derive `description` (acronym-aware: RFQ/MRP), parse
  `inject`, build-time hard-fail on bad `param`/`as`.
- P3 registry/executor consume unified `inject`; collapse-safety
  assertion; runtime guard; 4 new equivalence tests.
- P4 `mcpTool()` normalizes annotation (defaults schema, resolves alias);
  sales (151) proven via hash invariant.
- P5 codemod all 15 modules; build-time check caught a real codemod bug
  (dropped required `argOrder` for destructured params) — fixed at root.

Bugs found & fixed:
- Pre-existing: ~7 service fns had wrong hand-written descriptions
  (e.g. `updateDefaultCustomerCc` labeled "seed company") feeding bad
  data into the embeddings corpus — now auto-corrected by derivation.
- Self-introduced & caught: NUL-byte file corruption (fixed), `param: ""`
  vs reader mismatch (made `param` properly optional), `argOrder` wrongly
  dropped for destructured params (build-time check caught it).

Files (all uncommitted, nothing committed per instruction):
- M: types.ts, mcpTool.ts, registry.ts, executor.ts,
  generate-mcp-manifest.ts, 15 *.service.ts, executor.test.ts,
  mcpTool.test.ts, spec doc
- new (untracked): scripts/codemod-mcp-annotation.ts

Follow-ups (not blocking):
- Regenerate `mcp-tools.json` is already current (hash unchanged).
- `FN_NAME_ACRONYMS` in the generator must be extended if a new acronym
  enters a service fn name (build will visibly mangle it otherwise).

## AuthContextHolder (ALS) — Step 1 (branch: auth-context-als-step1)
Plan: /home/samyak/.claude/plans/woolly-yawning-dragonfly.md
- [x] Create auth-context.ts (DONE)
- [x] Create auth-context.test.ts (DONE, 5 tests incl concurrency)
- [x] Export AuthContextHolder from index.ts (DONE)
- [x] executor.ts rewired; stripIdentity kept; injection removed (DONE)
- [x] executor.test.ts updated to new contract; 26 pass (DONE)
- [x] codemod-auth-als.ts written (exported + private helpers) (DONE)
- [x] Codemod run; 16 files rewritten; 5 edge helpers hand-fixed; 46 MCP tests pass; whole-repo tsc OOMs in this env (Step 2 will gate callers) (DONE)

## Step 2 progress (branch auth-context-als-step1)
- [x] #3 VERIFIED: RR root middleware runs for resource routes (3 tests pass)
- [x] #1 DONE: AuthContextHolder -> packages/auth; 5-field shape; 49 MCP tests pass
- [x] #4 RESOLVED: Bearer->carbon-key normalization moves into resolveAuthContext
- [x] resolveAuthContext extracted (incl #4 normalization via resolveApiKey)
- [x] authContextMiddleware created (packages/auth/middleware)
- [x] Middleware registered in erp+mes+academy root.tsx (auth first)
- [x] requirePermissions reads ALS; client+perm checks byte-identical; caught+fixed consoleMode and Bearer-key bugs
- [x] MCP route drops Bearer transform (handled by resolveApiKey)
- [x] Codemod: client re-added to 1108 service fns (Option C); idempotent
- [x] Codemod: 702 caller sites in 359 route files stripped of stale companyId/userId; idempotent; 49 MCP tests green

## Lazy client (reverses Option C) — core DONE this session
- [x] AuthClientScope + lazy getAuthClient() in packages/auth/.../auth-context.ts (7 tests: fail-closed, lazy, memoized, no-swap, per-request isolation)
- [x] middleware opens empty client scope (unconditional, before identity scope)
- [x] requirePermissions: 3 client-build sites → AuthClientScope.setFactory (logic byte-identical), returns client:getAuthClient() so 951 callers unchanged
- [x] exports extended (packages/auth + erp barrel); auth 7/7, MCP 49/49 green
- [x] Option C REVERSED: client param dropped from 1108 service fns (getAuthClient() added where used); 1556 caller sites in 768 files dropped client arg; idempotent; no double-source; MCP 49/49 + auth 7/7 green; throwaway script removed
- [ ] full build/tsc verification (cannot run here — OOM)

## 2026-05-19: Review found 8 real bugs in unverified bulk codemods
STOPPED blind bulk fixes (no working tsc here). Authoritative analysis +
safe fix rules + order: /home/samyak/.claude/plans/woolly-yawning-dragonfly.md
- [ ] BUG3 (systemic, tsc-driven): X.identity→ALS iff X is a param, leave if fetched row
- [ ] BUG1 executor CONTEXT_KEYS + BUG6 regenerate manifest (together)
- [ ] BUG4/5 hand-fix account.service.ts
- [ ] BUG2 verify benign / BUG7 resolve-once / BUG8 type map
- [ ] Full tsc + tests green on higher-RAM machine, THEN commit (split commits)
Hand-written core (holder/scope/middleware/requirePermissions) SOLID: 7+49 tests.
Nothing committed. Backups: /tmp/{bug3,revoc,als-c}-bak.

## 2026-05-19 (cont): safe bugs FIXED step-by-step & verified
- [x] BUG1 executor CONTEXT_KEYS from context + regression test (MCP 50/50)
- [x] BUG5 account.service.ts upsertUserAttributeValue ALS userId/updatedBy
- [x] BUG4 FALSE POSITIVE (codemod correct; removed dead destructures)
- [x] BUG2 benign-by-design (gated on BUG3) / BUG8 acceptable / BUG7 constrained+deferred
- [ ] BUG3 (tsc-driven, systemic) + BUG6 (regen manifest after) — higher-RAM machine
Tests green: MCP 50, auth 7. Nothing committed. Plan file authoritative.

## 2026-05-19: ALL 8 BUGS RESOLVED
- [x] BUG1 executor CONTEXT_KEYS + regression test
- [x] BUG3 codemod (220 A→ALS, fail-closed classifier) + 2 array-param hand-fixes; A=0, B=2 preserved, 0 cross-tenant errors
- [x] BUG4 false-positive / BUG5 fixed (account.service.ts)
- [x] BUG6 manifest regenerated (stale argOrder 1043→2 legit)
- [x] BUG2 benign-by-design / BUG7 constrained-deferred / BUG8 acceptable
Tests: MCP 50, auth 7 green. File-scoped syntax clean. ~877 files changed.
Throwaway scripts removed. NOT full-tsc-verified (OOM) — run full build before commit.

## 2026-05-19 LATER: bulk codemods SYSTEMICALLY BROKEN — STOP
Two reviews + verification: codemods only handled `client`-named callsites.
~239 serviceRole/db callsites arg-shifted. CLASS1 approval data corruption,
CLASS2 broken approvers, CLASS3 ~239 arg-shifts, CLASS4 serviceRole→RLS auth
downgrade (architectural). "57/57 green" measured WRONG surface.
NOT COMMIT-SAFE. Authoritative analysis + revert plan:
/home/samyak/.claude/plans/bug-analysis-and-revert.md
Keep hand-written core; revert bulk service/route/manifest to HEAD;
redo TYPE-driven w/ full tsc on bigger machine. Nothing committed.
