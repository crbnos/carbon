# Bill of Process: Opened Operation Redesign

Status: Implemented, not committed. Autonomous (self-approved after the user chose the preview approach). Builds on `.ai/specs/2026-11-05-part-bom-bop-tabs.md`. Research: `.ai/research/bom-bop-page-layout.md`.

## TL;DR

- Operation Type and the place its steps come from sit together in one box on Details.
- One sentence under the box says what the operator gets.
- Setup, Labor and Machine are always visible. The collapsed cards go away.
- The Steps tab has an Operator Preview button. It opens the operator screen in a modal.
- The Preview tab goes away. A type shows only the tabs its operator screen uses.
- The Bill of Process list says where the steps of each operation come from.

## Reading of the request

- **What:** make the opened operation easy to read, and let the author see the operator screen while editing steps.
- **Why:** Operation Type, Steps, Assembly Instruction and Inspection Plan work together, but the screen does not group them or explain them. Authors cannot see what the shop floor will show.
- **Where:** `apps/erp`, the operation form in `modules/items/ui/Item/BillOfProcess.tsx`, `OperationWorkspace.tsx`, `BillOfProcessTable.tsx` and the operation route.
- **Who:** planners and manufacturing engineers who author a make method.

## Problem

1. The instruction source picker (Procedure, Assembly Instruction, Inspection Plan) is a separate collapsed card below the time cards (`BillOfProcess.tsx:1712`, `:1787`, `:1847`). Nothing links it to Operation Type.
2. Setup, Labor and Machine are collapsed cards. A planner opens three cards to read three numbers.
3. The Preview tab always draws the Assembly screen (`OperationWorkspace.tsx:362`), also for a Process operation.
4. Some tabs edit content that the operator screen of that type never shows. Instructions text on an Assembly operation is an example (`AssemblyView.tsx` has no `workInstruction` read).

## Goals

1. Group Operation Type with its instruction source, with a one-line explanation.
2. Show every time field without a click.
3. Show a preview of the operator screen inside the Steps tab.
4. Show only the tabs the operator screen of the type uses.
5. Say in the Bill of Process list where the steps come from.
6. Keep every save path, lock and permission as it is.

## Non-goals

- Live preview while a person types. The preview follows the saved data.
- Job and Quote editors. They have their own `OperationForm` copies.
- Renames of fields, types or tables. No schema change.

## Design

### Details tab (`OperationForm`)

The form keeps its fields, validator, action and Save button. The layout changes:

1. Row 1: Process, Operation Type, Work Center (or Supplier for Outside Processing), as today.
2. Row 2: Description and Operation Order, as today.
3. A bordered box under the rows, titled "What the operator gets":
   - Process: the Procedure picker.
   - Assembly: the Assembly Instruction picker.
   - Inspection: the Inspection Plan picker.
   - Outside Processing: no picker.
   - A sentence under the picker. See "Operator sentences".
4. Setup, Labor and Machine: each is one always-visible row with the existing hint, time and unit fields. Machine shows for Process only, as today.

The Operation Type select stays in row 1, because the box reads it. The box changes when the type changes.

### Operator sentences

The sentence has 2 parts: the screen of the type, then where the steps come from. The source is `getOperationTabSources(...).steps`, the same rule as the Steps tab, the preview and job creation: a procedure first, whatever the type, then an assembly instruction.

| Part | Text |
|---|---|
| Screen, Process | Operators get the Operation screen. |
| Screen, Assembly | Operators get the Assembly screen, one step at a time. |
| Steps from a procedure | The steps come from the procedure. |
| Steps from an assembly instruction | The steps come from the assembly instruction. |
| Own steps | You write the steps in the Steps tab. |
| Inspection, no procedure | Operators get the Inspection screen. The characteristics come from the plan. |
| Outside Processing | Operators do not see this operation. A supplier does the work. |

A source picker shows for its own type, and also for any type while it holds a value. So an author can see and clear a source that jobs still use.

### Tabs (`OperationWorkspace`)

| Type | Tabs |
|---|---|
| Process | Details, Steps, Parameters, Instructions, Tools |
| Assembly | Details, Steps, Parameters, Tools |
| Inspection | Details, Steps |
| Outside Processing | Details |

- The Preview tab is removed.
- A `tab` search value that the type does not show falls back to Details.
- Procedure content stays read-only in Steps, Parameters and Instructions, as today.

### Steps tab

The steps use the full width of the tab, as before. An "Operator Preview" button sits at the top right of the tab. It opens a modal (`ModalContent size="xxxlarge"`, title "Operator Preview"). The modal frames the MES preview page.

| Source | Preview steps |
|---|---|
| Own steps | The saved steps |
| Procedure | The procedure steps |
| Assembly Instruction | The instruction's build steps, with its model, slides, tools and part links |
| Inspection Plan | The Inspection screen with the plan characteristics |

### Preview (`OperatorPreviewButton`, `modules/items/ui/Item/OperatorPreview.tsx`)

The button opens the modal. The modal holds an iframe to `path.to.external.mesOperationPreview(operationId)`.

### MES preview page (`apps/mes/app/routes/x+/preview.$operationId.tsx`)

1. The loader requires `view: parts`. Then it calls `getMethodOperationPreview` (`apps/mes/app/services/preview.service.ts`).
2. The service reads the saved Bill of Process row. It shapes the row like a fresh job operation (Todo, quantity 1).
3. The steps follow job creation: a procedure, else an assembly instruction, else the operation's own steps.
4. The instruction rules come from `@carbon/utils` `assembly-instruction-job`. Job creation calls the same functions.
5. The page renders the real `AssemblyView`, `InspectionView` or `JobOperation`. It refuses Outside Processing with `OUTSIDE_PROCESSING_REFUSAL`.
6. The page records nothing. It refuses every request that is not a GET or a HEAD. It also stops clicks other than tabs and step movement.
7. The route sets `handle.chromeless`, so the MES shell shows the page without its sidebar, tab bar or overlays.
8. The route allows the ERP origin to frame it (`frame-ancestors 'self' <ERP origin>`). Every other MES page stays same-origin only.

### Bill of Process list (`BillOfProcessTable`)

The Steps cell becomes two lines:

| Source | Line 1 | Line 2 |
|---|---|---|
| Own steps | "5 steps" | "Written here" |
| Procedure | "Procedure" | (none) |
| Assembly Instruction | "Assembly Instruction" | (none) |
| Inspection Plan | "Inspection Plan" | (none) |
| Outside Processing | "—" | (none) |

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Preview code | The ERP modal frames a view-only MES page that renders the real MES screens | The user asked for the exact screen in every case. One source, no copy |
| Framing | Only the preview page allows the ERP origin (`frame-ancestors 'self' <ERP origin>`) | The MES blocks framing elsewhere. The page writes nothing, and it needs the parts view permission |
| Steps tab layout | A button that opens the preview in a modal | The user asked for it. The steps keep the full width, and the modal is wide enough for the MES two-column layout |
| Preview data | Saved data | Every step write already revalidates the route. No new state |
| Form scope | Change the shared `OperationForm` | One form, one behavior. Tool, Service and Change Notice get the same grouping |
| Times | Always visible rows | Three numbers need no clicks |
| Tabs | Per type, as in the Tabs table | Show what the operator screen uses |

## Autonomous Decisions

High-stakes first.

- [x] Change the shared `OperationForm`, also for Tool, Service and Change Notice? — **Autonomous:** yes — the confusion is the same on every page, and one form keeps one behavior (rung 2). **This widens the scope past the part page; review it.**
- [x] Keep the Tools tab on a Process operation, although the Operation screen does not show tools? — **Autonomous:** keep it — tools are a resource that the job copies and the MES reads (`apps/mes/app/services/operations.service.ts`). Removing the tab would strand data (rung 2). **Review it.**
- [x] Hide Instructions on an Assembly operation? — **Autonomous:** hide the tab — the Assembly screen has no `workInstruction` read. Saved text stays in the row and still copies to jobs (rung 1).
- [x] Hide Parameters, Tools and Instructions on an Inspection operation? — **Autonomous:** hide them — the Inspection screen shows the plan only (rung 1).
- [x] Steps tab layout — **Answer:** an Operator Preview button that opens a modal (the user's choice, after the split layout was rejected).
- [x] Inspection preview — **Autonomous:** a notice with a link — plan features are not in the ERP read (`mapInspectionDocument` returns `features: []`) (rung 2).
- [x] Procedure step counts in the list — **Autonomous:** no count for linked sources — it needs a new read per row (rung 5, YAGNI).
- [x] Preview updates — **Autonomous:** from saved data — each form already saves and revalidates (rung 2).
- [x] Sentence wording — **Autonomous:** the table in "Operator sentences" — plain words, one idea per sentence (rung 5).
- [x] Which steps the preview shows when a row has both a procedure and an assembly instruction — **Autonomous:** the procedure's, as job creation does (`insertProcedureDataForJobOperation` runs when `procedureId` is set, `production.service.ts:15265`) (rung 2). Found in review: the first build showed the instruction's steps.

## Acceptance Criteria

1. On SAT-1000, open "Acceptance test review". Details shows the "What the operator gets" box with the Procedure picker and the sentence for Process without a procedure.
2. Setup, Labor and Machine show their fields without a click.
3. Change Operation Type to Assembly. The box shows the Assembly Instruction picker and the Assembly sentence. Machine hides.
4. The tabs are Details, Steps, Parameters, Instructions, Tools for Process, and Details, Steps, Parameters, Tools for Assembly. No Preview tab.
5. On "TVAC qualification test", Steps shows the procedure steps on the left and an Operation screen preview with 7 steps on the right.
6. On "Systems integration", Steps shows the instruction notice and an Assembly screen preview with the instruction steps. Next moves to step 2.
7. Add a step on a Draft method. After the save, the preview shows the new step.
8. The Bill of Process list shows "Procedure" on TVAC and "Assembly Instruction" on Systems integration.
9. The Tool page Bill of Process shows the new Details box.
10. Scoped typecheck, Biome and the items unit tests pass.

## Open Questions

- [x] Preview approach — **Answer:** first an ERP copy; then shared display pieces; at last, at the user's request, the real MES screens on a view-only MES page that the ERP frames.
- [x] All other questions — see Autonomous Decisions.

## Changelog

- 2026-11-12: First version.
- 2026-11-12: The Assembly preview renders the whole MES Assembly screen layout (`OperatorAssemblyFrame` and its pieces) and the same part rule (`getVisibleStepMaterials`): a part with no step link shows on the first step.
- 2026-11-12: The preview and the MES screens shared display pieces for a time (replaced, see below).
- 2026-11-12: The preview moved from beside the steps into a modal behind a button.
- 2026-11-12: Implemented. Preview follows job creation for a row with two sources. Removed the unused `preview` source.
- 2026-11-12: The preview is now the real MES screen. The ERP modal frames `/x/preview/:operationId` in the MES. The page blocks every action. The shared `@carbon/react/OperatorScreen` pieces are removed, and the MES components are back as they were.
- 2026-11-12: Review fix. The preview built its own copy of an assembly instruction, and it did not match job creation. Both now call `@carbon/utils` `assembly-instruction-job`. The preview drops sub-assembly headers, adds the model and step slides, and adds the instruction tools and part links. It also lists parts by part number with kit components, as the MES part reader does.
- 2026-11-13: Second review fixes. A linked part goes to the first line by `order`, in the preview and in the job. The MES shell reads `handle.chromeless` instead of a path. The preview page refuses every request that is not a read. Removed the unreachable Outside Processing notices.
- 2026-11-16: Third review fixes. The preview page refuses console mode, because a console has a PIN-in gate the bare page does not show. The Inspection preview passes one running labor event: the real screen starts the labor clock on open, and the preview must not ask for that write.
- 2026-11-16: Fourth review fix. The Details sentence follows the job's source rule, and a set source picker stays visible under any type. An inspection plan counts as the step source only on an Inspection operation.
