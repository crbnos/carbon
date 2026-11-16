# Bill of Process opened operation redesign — implementation plan

**Spec / source:** `.ai/specs/2026-11-12-bop-operation-redesign.md`
**Branch:** `aashu0148/bom/bop-redesign`

## Progress
- [x] Task 1: Pure helpers for tabs and step sources
- [x] Task 2: Operation form — the "What the operator gets" box and open time rows
- [x] Task 3: `OperatorPreview` component
- [x] Task 4: Route loader reads the assembly instruction steps
- [x] Task 5: `OperationWorkspace` — tabs per type, preview in Steps
- [x] Task 6: Bill of Process list — Steps cell
- [x] Task 7: Verify (typecheck, Biome, tests, browser)

## Dependencies
Task 5 needs Tasks 1, 3 and 4. Tasks 2, 3, 4 and 6 are independent.

---

## Task 1: Pure helpers for tabs and step sources

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/methodPageUtils.ts` — add `getOperationTabs`
- Modify: `apps/erp/app/modules/items/ui/Item/methodPageUtils.test.ts` — tests

**Steps:**
1. Add `export type OperationTab = "details" | "steps" | "parameters" | "instructions" | "tools";`.
2. Add `export function getOperationTabs(operationType?: string | null): OperationTab[]`:
   - `"Outside Processing"` → `["details"]`
   - `"Inspection"` → `["details", "steps"]`
   - `"Assembly"` → `["details", "steps", "parameters", "tools"]`
   - any other value → `["details", "steps", "parameters", "instructions", "tools"]`
3. Add one test per type.

**Verify:**
```bash
cd apps/erp && npx vitest run app/modules/items/ui/Item/methodPageUtils.test.ts
# Expected: all tests pass
```

**Out of scope:** `getOperationTabSources` behavior.

## Task 2: Operation form — the box and open time rows

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` — `OperationForm`
- Precedent: the existing cards in the same function (`border border-border rounded-md shadow-sm p-4`)

**Steps:**
1. Remove `setupDisclosure`, `laborDisclosure`, `machineDisclosure`, `procedureDisclosure`, `assemblyDisclosure`.
2. Setup, Labor and Machine cards: keep the card and the label row with its icon. Remove the badge, the chevron button and the click toggle. Remove the `hidden` class from the field grid.
3. Replace the Procedure, Assembly Instruction and Inspection Plan cards with one card, placed before the Setup card, when `operationType !== "Outside Processing"`:
   - Header: `LuMonitor` icon and the label "What the operator gets".
   - Body: the existing `Procedure`, `AssemblyInstruction` or `InspectionDocument` field for the type, with the same props as today.
   - A `text-sm text-muted-foreground` sentence from the spec's "Operator sentences" table. Read the link from `processData`.
4. For Outside Processing, keep the current supplier fields. Add the card with the Outside Processing sentence and no picker.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx
# Expected: no errors
```

**Out of scope:** the validator, the action, Job and Quote `OperationForm` copies.

## Task 3: `OperatorPreview` component

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/items/ui/Item/OperatorPreview.tsx`
- Precedent: `OperationPreview` in `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx:3566`, and the MES screens `apps/mes/app/components/JobOperation/JobOperation.tsx:2305` (Instructions tab) and `apps/mes/app/components/AssemblyView.tsx:2488` (sidebar)

**Steps:**
1. Export `type PreviewStep = { id: string; name: string; type: string; description?: unknown; minValue?: number | null; maxValue?: number | null; unitOfMeasureCode?: string | null; listValues?: string[] | null; slideImagePath?: string | null; partLabels: string[]; toolLabels: string[] }`.
2. Export `OperatorPreview({ operationType, steps, parameters, instructions, linkedDocument })`.
   - Process: the Operation screen. A list of steps (`ProcedureStepTypeIcon`, name, "Must be between X and Y UNIT" for Measurement, "Choose one: …" for List, description). Then Parameters (key, value). Then the instructions HTML in a `ClientOnly`.
   - Assembly: the Assembly screen. A bar "n / N" with Previous and Next. The current step: image (`getPrivateUrl`) when set, number, type badge, name, description, parts, tools. Then Parameters.
   - Inspection: a notice "The Inspection screen shows the characteristics of the plan." with the plan link.
   - Empty steps: "No steps yet."
3. Header: the screen name ("Operation screen", "Assembly screen", "Inspection screen") and "What the operator sees".

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/items/ui/Item/OperatorPreview.tsx
# Expected: no errors
```

**Out of scope:** `OperationPreview` used by Tool, Service and Change Notice.

## Task 4: Route loader reads the assembly instruction steps

> Reverted. The route reads only the procedure again. The MES preview page reads the instruction (see the spec, "MES preview page").

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/x+/part+/$itemId.bill-of-process.$operationId.tsx`

**Steps:**
1. Select `procedureId, assemblyInstructionId` from `methodOperation`.
2. Run the procedure read and `getAssemblyInstructionSteps(client, id)` (`~/modules/production/production.service`) together with `Promise.all`.
3. Return `{ procedure, assemblyInstructionSteps: steps.data ?? [] }`. Pass both to `OperationWorkspace`.

**Verify:**
```bash
pnpm exec biome check 'apps/erp/app/routes/x+/part+/$itemId.bill-of-process.$operationId.tsx'
# Expected: no errors
```

**Out of scope:** other routes.

## Task 5: `OperationWorkspace` — tabs per type, preview in Steps

**Depends on:** Tasks 1, 3, 4
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/OperationWorkspace.tsx`

**Steps:**
1. Build the tab list from `getOperationTabs(item.data.operationType)`. Remove the Preview tab and its panel. A requested tab that is not in the list falls back to `details`.
2. Steps panel: wrap in `@container`. Inside, a grid `grid-cols-1 @min-[56rem]:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-4`. Left: the content today. Right: `OperatorPreview` with steps mapped from the source (own steps, procedure steps, assembly instruction steps).
3. Map parts with `page.methodMaterials` and the items store. Map tools with the tools store.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: no errors in the changed files
```

**Out of scope:** the card editor in `BillOfProcess`.

## Task 6: Bill of Process list — Steps cell

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfProcessTable.tsx:150`

**Steps:**
1. Own steps: two lines, "{n} steps" and a muted "Written here".
2. Procedure, Assembly Instruction, Inspection Plan: the label as plain text.
3. Outside Processing: "—".

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/items/ui/Item/BillOfProcessTable.tsx
# Expected: no errors
```

## Task 7: Verify

**Depends on:** all
**Steps:**
1. `pnpm exec turbo run typecheck --filter=erp --concurrency=1` — expect success.
2. `pnpm exec biome check` on the changed files — expect no errors.
3. `cd apps/erp && npx vitest run app/modules/items` — expect all pass.
4. In the browser on this worktree's stack (`ERP_URL` in `.env.local`), check the spec's acceptance criteria 1 to 9 and screenshot the Steps tab of each operation.
