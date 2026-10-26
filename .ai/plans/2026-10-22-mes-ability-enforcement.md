# MES ability enforcement — implementation plan

**Spec:** `.ai/specs/2026-10-22-mes-ability-enforcement.md`
**Branch:** `feat/mes-ability-enforcement`
**Worktree:** `/Users/aashu/work/carbon/carbon-feat-mes-ability-enforcement`

## Progress

- [x] Task 0: Set up the worktree
- [x] Task 1: Add the `processAbilityPolicy` column
- [x] Task 2: Regenerate the database types
- [x] Task 3: Add the ERP model and service input
- [x] Task 4: Add the choice to the Shop Floor card
- [x] Task 5: Return structured eligibility from `getOperationEligibility`
- [x] Task 6: Apply the policy at both Start paths
- [x] Task 7: Add the `AbilityWarning` component
- [x] Task 8: Show the banner on the three operation views
- [x] Task 9: Extract Lingui strings
- [ ] Task 10: Verify end to end

## Deviations

- After review, the mode moved from `companySettings.processAbilityPolicy` to `process.abilityPolicy` (migration `20261022063357_process-ability-policy.sql`), edited on the process form. Tasks 3–4 (the Shop Floor card) were reverted. See the spec changelog.

- Task 0: `crbn up --no-portless` could not bind Kong (port 54321 is held by another worktree's stack). Postgres started, so the migration and type generation ran. The browser test needs the portless proxy.
- Task 8: the three loaders call one helper, `getAbilityWarning` (`operations.service.ts`), instead of repeating the eligibility and policy reads.
- Task 2: `pnpm db:migrate` also regenerated `swagger-docs-schema.ts`. That diff includes drift that was already on `main` (`training.videoUrl`).

## Dependencies

- Task 2 needs Task 1. Task 1 needs Task 0.
- Tasks 3–4 need Task 2. Task 4 needs Task 3.
- Task 5 needs Task 2. Tasks 6 and 8 need Task 5. Task 8 needs Task 7.
- Task 9 needs Tasks 4, 7 and 8. Task 10 needs every other task.
- Tasks 3–4 and Tasks 5–8 are independent of each other.

Memory rule: run one heavy command at a time (install, typecheck, migrate). Check free memory first with `memory_pressure | tail -1`.

---

## Task 0: Set up the worktree

**Depends on:** none
**Files:** none in git.

**Steps:**
1. Run `pnpm install` in the worktree.
2. Symlink the main checkout's secrets: `ln -s ../carbon/.env .env`.
3. Run `pnpm exec crbn up` to start this worktree's own stack and write `.env.local`.

🛑 Step 3 starts a second Docker stack next to `carbon-feat-training-video-context`. Ask the user before you run it.

**Verify:**
```bash
test -f .env.local && echo ok
# Expected: ok
```

**Out of scope:** Never rebuild or reset the database.

---

## Task 1: Add the `processAbilityPolicy` column

**Depends on:** 0
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_process-ability-policy.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260728120100_incomplete-picking-list-policy.sql`

**Steps:**
1. Run `pnpm db:migrate:new process-ability-policy`.
2. Put this SQL in the new file:
   ```sql
   -- What MES does when an operator starts an operation whose process requires
   -- an ability they do not hold (no employeeAbility row, or an expired one).
   -- 'warn' shows a banner and lets them start; 'block' refuses Start.
   ALTER TABLE "companySettings"
     ADD COLUMN IF NOT EXISTS "processAbilityPolicy" TEXT NOT NULL DEFAULT 'warn'
     CHECK ("processAbilityPolicy" IN ('warn', 'block'));
   ```
3. Run `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: no pending migrations, no error
```

**Out of scope:** The `ability`, `employeeAbility`, `process` and `training` tables.

---

## Task 2: Regenerate the database types

**Depends on:** 1
**Steps:**
1. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -rn "processAbilityPolicy" packages/database/src/types.ts | head -3
# Expected: at least one line (Row, Insert, Update of companySettings)
```

If the generated file is not `packages/database/src/types.ts`, grep `packages/database/src` instead. Never hand-edit it.

---

## Task 3: Add the ERP model and service input

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — add the policy constant and type below `incompletePickingListPolicyValidator`.
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — add the field to `updateProductionSettings.input`.

**Steps:**
1. In `settings.models.ts`, add:
   ```ts
   // What MES does when an operator lacks the ability an operation's process
   // requires. 'warn' shows a banner and lets them start; 'block' refuses Start.
   export const processAbilityPolicies = ["warn", "block"] as const;
   export type ProcessAbilityPolicy = (typeof processAbilityPolicies)[number];
   ```
2. In `settings.server.ts`, import `processAbilityPolicies` from `./settings.models`.
3. Add `processAbilityPolicy: z.enum(processAbilityPolicies).optional(),` to the `updateProductionSettings` input object, after `autoSelectMaterialWithoutPickingList`.

**Verify:** typecheck runs in Task 4.

**Out of scope:** `updateInventorySettings`, `updateResourcesSettings`.

---

## Task 4: Add the choice to the Shop Floor card

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/production.tsx`
- Copy from (precedent): `IncompletePickingListPolicyChoice` in `apps/erp/app/routes/x+/settings+/inventory.tsx:535-565`

**Steps:**
1. Add to `productionSettingsForm`:
   ```ts
   z.object({
     intent: z.literal("processAbilityPolicy"),
     processAbilityPolicy: z.enum(processAbilityPolicies)
   }).transform(({ processAbilityPolicy }) => ({ processAbilityPolicy })),
   ```
2. In `productionSettingsMessage`, before the final return, add: if `data.processAbilityPolicy !== undefined`, return `` t`Ability enforcement updated` ``.
3. Read the current value: `const processAbilityPolicy = (companySettings.processAbilityPolicy ?? "warn") as ProcessAbilityPolicy;`.
4. Add a handler:
   ```ts
   const handleProcessAbilityPolicyChange = useCallback(
     (value: ProcessAbilityPolicy) => {
       fetcher.submit(
         { intent: "processAbilityPolicy", processAbilityPolicy: value },
         { method: "POST" }
       );
     },
     [fetcher]
   );
   ```
5. In the Shop Floor card, after the `autoSelectMaterialWithoutPickingList` row, add a `<Separator />` and this block:
   - A `VStack` with title `<Trans>Operators without the required ability</Trans>`.
   - A muted line: `<Trans>Operators get an ability by completing the training that grants it.</Trans>`
   - A `ChoiceSelect<ProcessAbilityPolicy>` with `value={processAbilityPolicy}`, `onChange={handleProcessAbilityPolicyChange}`, `disabled={isToggling}` and these options:
     - `warn`: title `` t`Warn but allow` ``, description `` t`The operator sees a warning and can still start the operation.` ``, icon `<LuTriangleAlert />`.
     - `block`: title `` t`Block until trained` ``, description `` t`The operator cannot start the operation until they complete the training.` ``, icon `<LuShield />`.
6. Import `ChoiceSelect` from `@carbon/react`, `LuShield` and `LuTriangleAlert` from `react-icons/lu`, and `processAbilityPolicies` and `type ProcessAbilityPolicy` from `~/modules/settings/settings.models`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful (or all successful), no TS errors
```

**Out of scope:** The other cards on the page.

---

## Task 5: Return structured eligibility from `getOperationEligibility`

**Depends on:** 2
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts:1588-1686`

**Steps:**
1. Add an exported type above the function:
   ```ts
   export type OperationEligibility =
     | { eligible: true }
     | {
         eligible: false;
         processName: string;
         // null when the operator never held the ability
         expiredOn: string | null;
         // an Active training that grants the ability, when one exists
         trainingName: string | null;
       };
   ```
2. Change the return type to `Promise<OperationEligibility>`. Replace every `{ eligible: true, reason: null }` with `{ eligible: true }`.
3. Before each of the two ineligible returns, read the training once:
   ```ts
   const training = await client
     .from("training")
     .select("name")
     .eq("grantsAbilityId", ability.data.id)
     .eq("companyId", companyId)
     .eq("status", "Active")
     .limit(1)
     .maybeSingle();
   ```
   Put this read in a small local helper so both branches share it. If `training.error` is set, use `trainingName: null`.
4. Return `{ eligible: false, processName: abilityName, expiredOn: null, trainingName }` for "no row". Return the same with `expiredOn: employeeAbility.data.expiresAt` for "expired".
5. Add an exported helper below the function:
   ```ts
   // English text for the server flash when Start is refused. MES routes have
   // no server-side translation; the page banner carries the translated text.
   export function abilityRefusalMessage(
     eligibility: Extract<OperationEligibility, { eligible: false }>
   ): string {
     const how = eligibility.trainingName
       ? `Complete the ${eligibility.trainingName} training to get it.`
       : `Ask a supervisor to add it to your profile.`;
     const expired = eligibility.expiredOn
       ? ` Your qualification expired on ${eligibility.expiredOn}.`
       : "";
     return `You need the ${eligibility.processName} ability to start this operation.${expired} ${how}`;
   }
   ```
6. Add `getProcessAbilityPolicy(client, companyId): Promise<ProcessAbilityPolicy>` in the same file. It reads `companySettings.processAbilityPolicy` by `id = companyId`. On error or a value other than `"block"`, it returns `"warn"`. Define `type ProcessAbilityPolicy = "warn" | "block"` locally in MES (MES cannot import ERP modules).

If `companySettings` is not keyed by `id = companyId`, copy the filter that `getCompanySettings` in `apps/mes/app/services/inventory.service.ts:90-99` uses.

**Verify:** typecheck runs in Task 6.

**Out of scope:** The lookup chain and the fail-open rule. `packages/planning`.

---

## Task 6: Apply the policy at both Start paths

**Depends on:** 5
**Files:**
- Modify: `apps/mes/app/routes/x+/event.tsx:93-102`
- Modify: `apps/mes/app/routes/x+/start.$operationId.tsx:165-180`

**Steps:**
1. In `event.tsx`, replace the eligibility block with:
   ```ts
   const eligibility = await getOperationEligibility(serviceRole, {
     operationId: d.jobOperationId,
     employeeId: userId,
     companyId
   });
   if (
     !eligibility.eligible &&
     (await getProcessAbilityPolicy(serviceRole, companyId)) === "block"
   ) {
     return refused(abilityRefusalMessage(eligibility));
   }
   ```
2. In `start.$operationId.tsx`, use the same condition. Keep the existing `throw redirect(path.to.operation(operationId), await flash(...))`. Pass `abilityRefusalMessage(eligibility)` as the message.
3. Update the imports in both files.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** The Outside Processing refusal and the machine permission check in `event.tsx`.

---

## Task 7: Add the `AbilityWarning` component

**Depends on:** 5
**Files:**
- Create: `apps/mes/app/components/AbilityWarning.tsx`
- Copy from (precedent): the batch `Alert` in `apps/mes/app/components/JobOperation/JobOperation.tsx:1236-1264`; `Alert variant="warning"` in `apps/mes/app/components/Inspection/DispositionModal.tsx:478`

**Steps:**
1. Start the file with the AGPL SPDX header. Copy the three header lines from `JobOperation.tsx:1-3`.
2. Export this type and component:
   ```ts
   export type AbilityWarningData = {
     policy: "warn" | "block";
     processName: string;
     expiredOn: string | null;
     trainingName: string | null;
   };
   export function AbilityWarning({ warning }: { warning: AbilityWarningData }) { ... }
   ```
3. Render `<Alert variant={warning.policy === "block" ? "destructive" : "warning"}>` with `<LuTriangleAlert />`.
4. Title (`<Trans>`, use local consts so the macro gets plain identifiers):
   - `warn`: "You don't have the {processName} ability"
   - `block`: "You can't start this operation"
5. Description lines (`<Trans>`):
   - If `expiredOn`: "Your {processName} qualification expired on {expiredDate}." Format the date with `formatDate(expiredOn, undefined, locale)` from `@carbon/utils`. Read `locale` the way other MES components do (grep `useLocale` in `apps/mes/app/components`).
   - If `trainingName`: "Complete the {trainingName} training to get the {processName} ability."
   - Else: "Ask a supervisor to add the {processName} ability to your profile."
   - If `warn`: add "You can still start this operation."

**Verify:** typecheck runs in Task 8.

**Out of scope:** Disabling any Start button.

---

## Task 8: Show the banner on the three operation views

**Depends on:** 5, 7
**Files:**
- Modify: `apps/mes/app/routes/x+/operation.$operationId.tsx` — loader + render
- Modify: `apps/mes/app/routes/x+/assembly.$operationId.tsx` — loader
- Modify: `apps/mes/app/routes/x+/inspection.$operationId.tsx` — loader
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` — prop + render
- Modify: `apps/mes/app/components/AssemblyView.tsx` — prop + render
- Modify: `apps/mes/app/components/Inspection/InspectionView.tsx` — prop + render

**Steps:**
1. In each loader, compute the warning once:
   ```ts
   const [eligibility, processAbilityPolicy] = await Promise.all([
     getOperationEligibility(serviceRole, { operationId, employeeId: userId, companyId }),
     getProcessAbilityPolicy(serviceRole, companyId)
   ]);
   const abilityWarning: AbilityWarningData | null = eligibility.eligible
     ? null
     : { policy: processAbilityPolicy, ...eligibility };
   ```
   Spread only `processName`, `expiredOn` and `trainingName`, not `eligible`. Put the call next to an existing `Promise.all` where one exists. Return `abilityWarning` from the loader.
2. In `operation.$operationId.tsx`, read `abilityWarning` from `useLoaderData` and pass it to `<JobOperation abilityWarning={abilityWarning} />`.
3. The assembly and inspection routes spread `data` into the view, so only the view props change.
4. Add `abilityWarning?: AbilityWarningData | null` to the props of `JobOperation`, `AssemblyView` and `InspectionView`.
5. Render positions:
   - `JobOperation.tsx`: just before `{scope === "job" && batch && (` (line 1236). Wrap it: `{abilityWarning && (<div className="px-4 pt-4 lg:px-6"><AbilityWarning warning={abilityWarning} /></div>)}`.
   - `AssemblyView.tsx`: after `{!detailsShown && renderPhoneContext()}` (line 1913). Wrapper class `shrink-0 px-4 pt-3`.
   - `InspectionView.tsx`: just before the `{/* Phones: the meta bar scrolls away with the body. */}` comment (line 763). Wrapper class `shrink-0 px-4 pt-3`.

If a wrapper breaks the view's layout (grid areas, a fixed height), STOP and report. Do not improvise a new layout.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** The batch overview, the phone context row, the Controls component.

---

## Task 9: Extract Lingui strings

**Depends on:** 4, 7, 8
**Steps:**
1. Run `pnpm lingui:extract`.
2. Run `pnpm lingui:clean`.

**Verify:**
```bash
git diff --stat -- packages/locale/locales/en/erp.po packages/locale/locales/en/mes.po
# Expected: both files changed
grep -c "Block until trained" packages/locale/locales/en/erp.po
# Expected: 1
```

**Out of scope:** `pnpm translate` (LLM translation of the other locales). Ask the user first.

---

## Task 10: Verify end to end

**Depends on:** all
**Steps:**
1. Run `pnpm exec biome check` on the changed files (`git diff --name-only`).
2. Run `pnpm exec turbo run typecheck --filter=erp`, then `--filter=mes` (one at a time).
3. Run `pnpm --filter @carbon/checks license-headers` and confirm `AbilityWarning.tsx` has the header.
4. Ask the user before a browser test. If they agree, use the `/test` skill to walk spec acceptance criteria 2–9.
5. Tick the Progress list. Set the spec status to `in-progress`. Add a spec changelog line for any divergence.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: no TS errors
```

**Out of scope:** Commit. The user commits, or asks for a commit.
