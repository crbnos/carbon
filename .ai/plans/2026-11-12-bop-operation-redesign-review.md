# Thermo-Nuclear Review: Bill of Process opened operation redesign

Target: uncommitted working tree on `aashu0148/bom/bop-redesign`, against `HEAD` (798a777a94). Round 1, then one fix round.

## Blockers

| # | Finding | Location | Fix | State |
|---|---|---|---|---|
| 1 | The preview and the Steps tab showed the assembly instruction's steps for a row with both a procedure and an assembly instruction. Job creation copies the procedure's steps in that case, so the preview lied | `methodPageUtils.ts` `getOperationTabSources`, `OperationWorkspace.tsx` `previewSteps`; `production.service.ts:15265` | Restore procedure-first, the same order as job creation. Test pins it | Fixed (uncommitted) |

## Code-judo / simplification

| # | Finding | Fix | State |
|---|---|---|---|
| 2 | `preview` in `OperationTabSources` had no reader after the Preview tab went away | Removed from the type, the function and the tests | Fixed |
| 3 | A `Map` of every item name was built on each render to name parts, but `methodMaterials[].description` already holds the item name (`items.service.ts:9507`) | Use `material.description` | Fixed |

## Performance

- Reverted later: the MES preview page reads the instruction instead. Original note: one new read, `getAssemblyInstructionSteps` on the operation route, only when `assemblyInstructionId` is set, in parallel with the procedure read. Indexed by `assemblyInstructionStep_assemblyInstructionId_sortOrder_idx` (`20260610151942_assembly-instructions.sql:84`).
- Measured only on the demo seed (40 instruction steps). Not realistic-scale evidence; the read is one indexed query per page view.

## Security

- The new read uses the caller's client from `requirePermissions` (`view: parts`, `role: employee`), so RLS applies. `assemblyInstructionStep` has RLS enabled (`20260610151942_assembly-instructions.sql:88`). The instruction id comes from a `methodOperation` row filtered by `companyId`.

## Risks / questions

- The preview is a copy of the MES layout, not shared code. It can drift when the MES screens change. The user chose this.
- A row with a stale `procedureId` on an Assembly operation: the Details box shows the Assembly Instruction picker and its sentence, but the steps come from the procedure. The operation upsert clears a pointer that does not match the type on the next save. Only seeded data has this shape.
- Not exercised in a browser: Tool, Service and Change Notice pages, which share the changed `OperationForm`.
- No Lingui extract run. New strings are marked; the catalogs need `lingui:extract` and the translate gate before commit.

## Docs freshness

- `apps/erp/app/modules/items/AGENTS.md` updated (tabs, preview, form).

## Verification after the fixes

| Check | Result |
|---|---|
| `pnpm exec turbo run typecheck --filter=erp --concurrency=1` | 2 successful |
| `pnpm exec biome check --diagnostic-level=error` on the changed files | No errors |
| `npx vitest run app/modules/items` | 100 passed |
| Browser, Acceptance test review | Box with Procedure picker and sentence; open time rows; add a step, the preview shows it |
| Browser, type to Assembly (not saved) | Assembly Instruction picker, Assembly sentence, Machine hidden |
| Browser, TVAC | Procedure steps left, Operation screen preview right |
| Browser, Systems integration | Tabs Details, Steps, Parameters, Tools; preview 1 / 5 procedure steps |
| Browser, list | "Procedure" and "0 steps / Written here" in the Steps column |

## TLDR

**Blockers**
1. **The preview could show different steps from the ones the shop floor gets.**
   - For an operation with both a procedure and an assembly instruction, the screen used the instruction while job creation copies the procedure (`production.service.ts:15265`).
   - Fixed: the screen now follows job creation.

**Code-judo / simplification**
- **A leftover "preview" source value nobody reads.** Removed.
- **Item names rebuilt on every render.** The material row already has the name; used it.

**Risks / questions**
- **The preview can drift from the real shop-floor screens** because it is a copy.
- **An Assembly operation with an old procedure link** shows the instruction picker while its steps come from the procedure, until the next save clears the link.
- **Tool, Service and Change Notice pages share the new form** and were not checked in a browser.
- **Translations not extracted yet.**

## Verdict

Approve with changes: the one blocker is fixed. Check the Tool page form and run the translation gate before committing.
