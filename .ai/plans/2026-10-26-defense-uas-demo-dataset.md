# Defense UAS demo dataset — implementation plan

**Spec / source:** `.ai/specs/2026-10-26-defense-uas-demo-dataset.md`
**Branch:** `feat/defense-uas-dataset` (in the user's checkout `/Users/aashu/work/carbon/carbon`, never a worktree)
**Mode:** autonomous. Never run `git commit`: the user's standing rule forbids it without permission.

## Progress
- [x] Task 1: Create the branch
- [x] Task 2: Add the two optional seed fields (types, tiers 01 and 10, validator, tests)
- [x] Task 3: Align the model's product names with the BOM and export steps.json
- [x] Task 4: Build the assembler and bake the model
- [x] Task 5: Copy satellite into `data/defense` and register the dataset
- [x] Task 6: Add the industry migration and the onboarding icon
- [x] Task 7: Rewrite foundation, items and the assembly
- [x] Task 8: Rewrite inventory, sales and purchasing
- [x] Task 9: Rewrite production, quality and change orders
- [x] Task 10: Rewrite accounting, ops, workflows and planning
- [x] Task 11: Write the thumbnails
- [x] Task 12: Update the docs
- [x] Task 13: End-to-end verification (database checks passed in the follow-up run)

## Dependencies
- Task 2 needs Task 1. Tasks 3 and 4 are independent of Task 2 (they work outside the repo until Task 4's last step).
- Task 5 needs Task 2. Task 6 needs Task 5.
- Task 7 needs Tasks 4 and 5. Tasks 8, 9 and 10 need Task 7 and run in that order (later slices name earlier records).
- Task 11 needs Task 7 (it reads the final item list). Task 12 needs Tasks 6 and 7. Task 13 needs all.

## Global rules for every task
- 🛑 Before any typecheck, test, build or bake, check memory: `vm_stat`. Run one heavy process at a time.
- Use `pnpm`, never `npm`.
- All names are invented. Never write a real customer, person or company name.
- Dates in a dataset are `DayOffset` numbers. Never use JavaScript `Date` or `CURRENT_DATE`.

---

## Task 1: Create the branch

**Depends on:** none
**Files:** none

**Steps:**
1. Run `git -C /Users/aashu/work/carbon/carbon status --short`. If it lists files, STOP the branch step and report them.
2. Run `git -C /Users/aashu/work/carbon/carbon switch -c feat/defense-uas-dataset`.

**Verify:**
```bash
git -C /Users/aashu/work/carbon/carbon branch --show-current
# Expected: feat/defense-uas-dataset
```

**Out of scope:** commits, pushes.

---

## Task 2: Add the two optional seed fields

**Depends on:** 1
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `CustomerSpec` (line 66), `SupplierSpec` (line 78), `ItemSpec` (line 272)
- Modify: `packages/database/src/datasets/tiers/01-foundation.ts` — the customer-contact address (about line 379) and the supplier-contact address (about line 436)
- Modify: `packages/database/src/datasets/tiers/10-ops.ts` — after `seedCustomFields` (line 131)
- Modify: `packages/database/src/datasets/validate.ts` — two new rules
- Create: `packages/database/src/datasets/validate-seed-extensions.test.ts`
- Copy from (precedent): `packages/database/src/datasets/validate-assembly.test.ts`

**Steps:**
1. In `types.ts`, add this type above `CustomerSpec`:
   ```ts
   /** A party address that overrides `foundation.partyAddress*` (a foreign customer or supplier). */
   export type PartyAddressSpec = {
     addressLine1: string;
     city: string;
     stateProvince: string;
     postalCode: string;
     countryCode: string;
   };
   ```
2. Add `address?: PartyAddressSpec;` to `CustomerSpec` and to `SupplierSpec`.
3. Add to `ItemSpec`:
   ```ts
   /** Values for the item's custom fields, keyed by `CustomFieldSpec.name`. Written into the type table's `customFields`. */
   customFieldValues?: Record<string, string | number | boolean>;
   ```
4. In tier 01, at the customer-contact address insert, look up the customer spec by `cc.customer`. If it has `address`, write its five fields. Else keep the current `partyAddress*` values and `addressLine1: "See parent"`.
5. Do the same for the supplier-contact address (`sc.supplier`, fallback `addressLine1: "See supplier record"`).
6. In tier 10, after `seedCustomFields`, add `seedCustomFieldValues(ctx)`:
   1. Read `customField` ids: `SELECT id, "table", name FROM "customField" WHERE "companyId" = $1`.
   2. Map item type to table: Part → `part`, Material → `material`, Consumable → `consumable`, Tool → `tool`, Service → `service`.
   3. For each item spec with `customFieldValues`, build `{ [customField.id]: value }`.
   4. Run one `UPDATE "<table>" SET "customFields" = COALESCE("customFields", '{}'::jsonb) || $1::jsonb WHERE id = $2 AND "companyId" = $3` per item. The `id` is the item's `readableId` (`.claude/rules/revision-system.md`).
   5. Throw `Seed: custom field "<name>" not found on <table>` when a name has no row.
7. In `validate.ts`, add two rules next to the existing item rules. Follow their violation format:
   - Each `customFieldValues` key names a `ops.customFields` spec whose `table` is the item's type table.
   - Each `address.countryCode` matches `/^[A-Z]{2}$/`.
8. Write `validate-seed-extensions.test.ts` with 3 cases on a cloned satellite dataset: a valid value passes; an unknown field name fails; a `countryCode` of `"usa"` fails.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm --filter @carbon/database exec vitest run src/datasets/validate-seed-extensions.test.ts
# Expected: 3 passed
cd /Users/aashu/work/carbon/carbon && pnpm exec turbo run typecheck --filter=@carbon/database --concurrency=1
# Expected: 1 successful task
```

**Out of scope:** the four existing datasets' data files. They need no change because both fields are optional.

---

## Task 3: Align the model's product names and export steps.json

**Depends on:** none
**Files (outside the repo):**
- Modify: `/Users/aashu/work/carbon/plans/quad-model/quad.py`

**Steps:**
1. Make the top-level `sub()` names equal the BOM items in the spec §3: `AFR-100 Airframe`, `ARM-200 Arm Set`, `PRP-300 Propulsion Set`, `AVN-500 Avionics Bay`, `BAT-700 Power System`, `COM-800 Comms & Navigation`, `PLD-900 EO/IR Gimbal`, `LDG-950 Landing Gear`, `VNS-850 GPS-Denied Navigation Kit`, `LGT-700 Lighting & Safety`, `TRC-100 Identification & Data`. Rename the root to `ISR4-AV ISR-4 Air Vehicle`.
2. Re-key the `put()` step keys to the spec §4 step list (`01-pods`, `02-arm-*`, `03-avionics`, `04-gimbal`, `05-gear`, `06-frame`, … `19-final`).
3. Write `out/isr4-quad/isr4-quad.step` and `out/isr4-quad/steps.json` (step key → part names), like `cadlib.finish`.

**Verify:**
```bash
cd /Users/aashu/work/carbon/plans/quad-model && .venv/bin/python quad.py 2>&1 | grep "leaf parts"
# Expected: leaf parts 139
```

**Out of scope:** geometry changes. The user approved the look.

---

## Task 4: Build the assembler and bake the model

**Depends on:** 3
**Files:**
- Create (outside the repo): `/Users/aashu/work/carbon/plans/quad-model/bake.py` — copy of `plans/satellite-model/bake.py` with `WORKTREE = "/Users/aashu/work/carbon/carbon"` and `HERE` pointing at `quad-model`
- Create: `packages/database/src/datasets/assets/defense_uas/models/isr4-quad.glb`
- Create: `packages/database/src/datasets/assets/defense_uas/models/isr4-quad.graph.json`

**Steps:**
1. 🛑 Check memory first. Then run `brew install opencascade`.
2. Run `cargo build --release -p assembler` in `/Users/aashu/work/carbon/carbon` (binary at `target/release/assembler`).
3. Confirm Redis answers on `localhost:6379` (`redis-cli ping`). If not, STOP and re-decide with the resolution ladder.
4. Run `.venv/bin/python bake.py isr4-quad 0.5 0.3`.
5. If the GLB is over 3.5 MB, re-run with `1.0 0.5`.
6. Copy the GLB and graph into `assets/defense_uas/models/`.
7. Run `plans/satellite-model/motions/plan.py` per build (main build plus each sub-assembly) in fixed-sequence mode. If it fails, keep motion empty and record that in the spec.

**Verify:**
```bash
ls -la /Users/aashu/work/carbon/carbon/packages/database/src/datasets/assets/defense_uas/models/
# Expected: isr4-quad.glb (≤ 3,670,016 bytes) and isr4-quad.graph.json
```
Then count graph leaves with a one-line Node script. Expected: 139.

If the build fails because of a missing native library, re-decide with the resolution ladder, record it in the spec, and continue. Never improvise silently.

**Out of scope:** committing the STEP file or the scripts.

---

## Task 5: Copy satellite into `data/defense` and register the dataset

**Depends on:** 2
**Files:**
- Create: `packages/database/src/datasets/data/defense/*.ts` (14 files, copied from `data/satellite/`)
- Modify: `datasets/types.ts` — `DatasetKey` (line 2223) gains `"defense"`
- Modify: `datasets/index.ts` — import and `DATASETS` entry
- Modify: `datasets/tiers/workflow-definitions.ts` — `SEED_WORKFLOW_BUILDERS` gains `defense`

**Steps:**
1. Copy the 14 files.
2. In `data/defense/index.ts`, set `key: "defense"`, `label: "Defense & Unmanned Systems"`, `industryId: "defense_uas"`, company name "Halberd Unmanned Systems".
3. Rename every exported builder that `workflow-definitions.ts` imports, so the defense builder has its own name.
4. Register the key in all three places.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec turbo run typecheck --filter=@carbon/database --concurrency=1
# Expected: 1 successful task
```

**Out of scope:** content rewrites (Tasks 7–10).

---

## Task 6: Add the industry migration and the onboarding icon

**Depends on:** 5
**Files:**
- Create: a migration from `pnpm db:migrate:new add-defense-industry`
- Modify: `apps/erp/app/routes/onboarding+/industry.tsx` — `INDUSTRY_ICONS` (lines 77-82) and its `react-icons/lu` import
- Copy from (precedent): `packages/database/supabase/migrations/20260813023744_add-aerospace-industry.sql`

**Steps:**
1. Write the migration body: one `INSERT INTO "industry" ("id", "name", "description", "iconName", "sortOrder") VALUES ('defense_uas', 'Defense & Unmanned Systems', '<one sentence>', 'shield', 5) ON CONFLICT ("id") DO NOTHING;`. Copy the precedent's column list exactly.
2. Add `shield: <LuShield className="h-5 w-5" />` and import `LuShield`.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/routes/onboarding+/industry.tsx
# Expected: no errors
```

**Out of scope:** applying the migration (Task 13).

---

## Task 7: Rewrite foundation, items and the assembly

**Depends on:** 4, 5
**Files:** `data/defense/{foundation,items,assembly,index}.ts`

**Steps:**
1. Rewrite `foundation.ts` per spec §3: the plant (Huntsville, AL, `America/Chicago`), departments, abilities, processes, work centers (composite cutting, harness bench, avionics integration, motor run-in, calibration and hover cage, environmental test, final inspection), customer types, the six customers, at least 11 suppliers with the status rows, contacts and procedures (an AS9102-style FAI procedure, an ITAR handling procedure).
2. Give the Nordic agency `address: { countryCode: "NO", … }` and the EUR supplier `address: { countryCode: "DE", … }`.
3. Rewrite `items.ts`: the items in spec §3, the `ISR4-SYS` and `ISR4-AV` BOMs, routings, serial and batch tracking, shelf lives, supplier parts, inspection plans, the export enforcement rule, and `customFieldValues` on every part.
4. Rewrite `assembly.ts`: the spec §4 steps. Generate each step's `componentNodeIds` from `isr4-quad.graph.json` and `steps.json` with a script. Never hand-type a node id.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && CARBON_SKIP_DATASET_CHECK= pnpm db:check:datasets -- --dataset defense 2>&1 | tail -30
# Expected: no "foundation", "items" or "assembly" violations (later slices may still report)
```

**Out of scope:** the other slices.

---

## Task 8: Rewrite inventory, sales and purchasing

**Depends on:** 7
**Files:** `data/defense/{inventory,sales,purchasing}.ts`

**Steps:**
1. Rewrite every record to the drone story. Keep each status that satellite exhibits.
2. Sales: CLIN text on lines, DoD-format PO numbers (invented), the Nordic agency's Draft order with an `ISR4-SYS` line, spares and depot-repair orders, an RMA for a serialized radio.
3. Purchasing: POs to each supplier category, receipts with lot numbers, the Pending supplier's approval request.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm db:check:datasets -- --dataset defense 2>&1 | tail -30
# Expected: no inventory, sales or purchasing violations
```

---

## Task 9: Rewrite production, quality and change orders

**Depends on:** 8
**Files:** `data/defense/{production,quality,change-orders}.ts`

**Steps:**
1. Production: at least 18 jobs. The hero job is 6 × `ISR4-AV` for the Army office, In Progress, Hard Deadline. All open jobs are due within the validator's window.
2. Quality: NCR workflows (supplier escape with MRB, counterfeit suspect), the NCRs from spec §3, receipt inspections, three gauges, the risks.
3. Change orders: the arm Revision and the `AVN-500` Version. Keep only two leaf make parts locked (`onboarding-company-templates.md` → "Open change notices lock more").

**Verify:** the Task 8 command. Expected: no production, quality or change-order violations.

---

## Task 10: Rewrite accounting, ops, workflows and planning

**Depends on:** 9
**Files:** `data/defense/{accounting,ops,workflows,planning}.ts`

**Steps:**
1. Rewrite every record. Keep the period floors (`dates.ts`).
2. Ops: the five part custom fields and the job field from spec §3, serial sequences, trainings (ITAR awareness, IUID marking, flight test).
3. Rename the workflow builder's records to the drone story.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm db:check:datasets -- --dataset defense 2>&1 | tail -15
# Expected: the validator passes for "defense"
```

---

## Task 11: Write the thumbnails

**Depends on:** 7
**Files:** `packages/database/src/datasets/assets/defense_uas/<readableId>.svg`

**Steps:**
1. List the items that satellite illustrates. Pick the matching defense items (about 33).
2. Write one SVG per item: 1024 × 1024 viewBox, gradient fills, no text. Read two satellite SVGs first for the style.

**Verify:**
```bash
ls /Users/aashu/work/carbon/carbon/packages/database/src/datasets/assets/defense_uas/*.svg | wc -l
# Expected: ≥ 30
```

---

## Task 12: Update the docs

**Depends on:** 6, 7
**Files:**
- Modify: `packages/database/src/datasets/assets/ATTRIBUTION.md` — the ISR-4 row
- Modify: `.claude/rules/onboarding-company-templates.md` — five datasets; the icon step in "Adding an industry"; the two new spec fields; 261 floors
- Modify: `packages/database/src/datasets/AGENTS.md`, `packages/database/AGENTS.md` — the dataset count

**Verify:** `grep -n "Four\|four datasets" <each file>`. Expected: no stale count.

---

## Task 13: End-to-end verification

**Depends on:** all

**Steps:**
1. 🛑 Check memory.
2. Run `pnpm db:migrate` (applies the industry row to the local stack).
3. Run `pnpm db:check:datasets`. Expected: all five pass.
4. Run `pnpm exec turbo run typecheck --filter=erp --concurrency=1`. Expected: success.
5. Run `pnpm exec biome check` on every changed `.ts`/`.tsx` file. Expected: no errors.
6. Seed a fresh company with an unused email: `pnpm db:seed:dev -- --email defense-demo@example.com --dataset defense`.
7. With SQL, check spec acceptance 5 (the Nordic order's location address is `NO`, and the rule names `ISR4-SYS`) and 6 (the `ISR4-AV` part's `customFields` hold the three values).
8. Write the run log to `.ai/runs/2026-10-26-defense-uas-demo-dataset.md`.

**Out of scope:** the README / `www` hero swap.
