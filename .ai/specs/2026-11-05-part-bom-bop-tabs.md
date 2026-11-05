# Part Bill of Material and Bill of Process Tabs

Status: Autonomous (self-approved). Research: `.ai/research/bom-bop-page-layout.md`.

## TL;DR

- The part record gets two new tabs: Bill of Material and Bill of Process.
- Each tab shows a table of the method's lines.
- Clicking a row opens that line in the middle pane, at its own URL.
- The left column then lists the lines, so the next line is one click away.
- The Properties panel does not change, and no name changes.
- Tools, services, jobs, quotes and change notices keep today's editors.

## Reading of the request

- **What:** give the part record method tabs, and open a line in the content pane.
- **Why:** people who know ERP take too long to understand this screen. The hard part is the opened operation.
- **Where:** `apps/erp`, part record routes, and the items module UI.
- **Who:** planners and manufacturing engineers who edit a part's make method.

## Problem

Today the Details tab stacks Manufacturing, Notes, Bill of Process, Bill of Material, Files, CAD Model and Risks. Each line is a card that opens in place. An opened operation has six tabs inside a list row. There is no room for steps, and the page moves when a row opens.

## Goals

1. Show Bill of Material and Bill of Process as their own record tabs.
2. Show each list as a table with columns, units and words.
3. Open a line in the content pane at its own URL.
4. List the lines in the Explorer while a line is open.
5. Keep every capability that exists today.
6. Show inherited procedure content instead of a disabled tab.

## Non-goals

- Tool, Service, Job, Quote and Change Notice editors. They keep `BillOfProcess` and `BillOfMaterial`.
- Renames, and any database change.
- A change to how each tab saves.
- Inline cell edits, paste from Excel, and cost columns.
- Step editing in a 3-column layout with a live preview.

## Design

### Routes

All routes are children of `routes/x+/part+/$itemId.tsx`.

| Route file | URL | Purpose |
|---|---|---|
| `$itemId.bill-of-material.tsx` | `/x/part/:id/bill-of-material` | Layout. The loader reads the method |
| `$itemId.bill-of-material._index.tsx` | same | The table |
| `$itemId.bill-of-material.new.tsx` | `…/new` | Add Item |
| `$itemId.bill-of-material.$lineId.tsx` | `…/:lineId` | One line |
| `$itemId.bill-of-process.tsx` | `/x/part/:id/bill-of-process` | Layout. The loader reads the method |
| `$itemId.bill-of-process._index.tsx` | same | The table |
| `$itemId.bill-of-process.new.tsx` | `…/new` | Add Operation |
| `$itemId.bill-of-process.$operationId.tsx` | `…/:operationId` | One operation |

`$itemId.make.$makeMethodId.tsx` becomes a redirect to the Bill of Material tab. Its search params stay, so old links work.

### URL state

| Param | Meaning |
|---|---|
| `methodId` | The root method version. The part layout already reads it |
| `makeMethodId` | The sub-assembly method to show. Empty means the root method |
| `materialId` | The tree node. It drives Properties, as it does today |
| `tab` | The tab of an open operation |

Links from the table and between record tabs drop `tab`. The Details tab keeps the method search too. Next, previous and the Explorer list keep it, so one tab can be read line by line.

### Server

A new building block `getPartMethodPage(client, { itemId, companyId, methodId, makeMethodId })` in `items.service.ts` returns the page data, or null:

1. Read the item's methods, the revision lock, change notice data and manufacturing data.
2. Return null for a Buy part.
3. Pick the method. Use `makeMethodId` when set. Else use the `methodId` match, the Active method or the first method.
4. Read the method through `getMakeMethodById(client, id, companyId)`. Return null if the read fails.
5. Read materials, operations and configuration data for that method.

A null page makes the loader redirect to Details. The loaders require the `employee` role and use the caller's client without `bypassRls`, so RLS scopes every read. The Details loader stops reading materials and operations.

The operation route loader reads the linked procedure with `getProcedure`. A missing procedure shows the linked-document notice without content.

### UI units (`modules/items/ui/Item/`)

| Unit | Job | Depends on |
|---|---|---|
| `methodPageUtils.ts` | Pure helpers: tab gating, method links, line order | Nothing |
| `MethodPageFrame.tsx` | Method toolbar, line navigation, read-only rules, configurator | `MakeMethodTools` |
| `MethodTable.tsx` | Table shell, row shell, reorder, select, delete | `MethodPageFrame.tsx` |
| `BillOfProcessTable.tsx` | Operation columns | `MethodTable.tsx` |
| `BillOfMaterialTable.tsx` | Material columns | `MethodTable.tsx` |
| `MethodLineExplorer.tsx` | Explorer list of lines with an add button | Route data |
| `OperationWorkspace.tsx` | The opened operation and its tabs | `BillOfProcess.tsx` exports |
| `MaterialLineWorkspace.tsx` | The opened line | `BillOfMaterial.tsx` exports |

`BillOfProcess.tsx` exports `OperationForm`, `ParametersForm`, `AttributesForm`, `ToolsForm` and `OperationPreview`. `BillOfMaterial.tsx` exports `MaterialForm`. Their behavior stays the same for existing callers. `onSubmit` also receives the saved id, so a new line can open after its first save.

### Bill of Process table

Columns: reorder handle, select, Operation, Operation Type, Work Center, Setup, Labor, Machine, Steps, Tools. A container query hides Setup and Machine when the pane is narrow. The Steps cell shows a badge when a Procedure, Assembly Instruction or Inspection Plan supplies the steps.

### Bill of Material table

Columns: reorder handle, select, Item, Quantity with unit, Method Type, Sourcing (Buy and Make parents only), Operation. An empty Operation shows "First Operation". The Item cell keeps `MaterialRowTitle`, with its lifecycle, storage unit and rule markers.

### Opened operation

The header is one line: a back link to Bill of Process, the description, a lock hint, and previous and next buttons. The version shows on the table, not on an opened line. Only the open tab mounts, as in the card editor. Below it are today's tabs: Details, Instructions, Parameters, Steps, Tools, Preview. Each tab starts with one line that says who uses it.

| Tab | Procedure linked | Assembly Instruction or Inspection Plan | Outside Processing |
|---|---|---|---|
| Instructions | Procedure content, read-only | Own editor | Notice |
| Parameters | Procedure parameters, read-only | Own form | Notice |
| Steps | Procedure steps, read-only | Notice with a link | Notice |
| Tools | Own form | Own form | Notice |
| Preview | Notice: the procedure supplies it | Notice with a link | Notice |

### Explorer

With a line open, the Explorer tabs are Operations (or Items), Manufacturing, Used In. The list tab shows first. With no line open, the tabs stay Manufacturing and Used In.

A tree node click stays on the current method tab. It sets `makeMethodId` for a sub-assembly and clears it for the root. From another record tab, the root keeps today's Details link and a sub-assembly goes to Bill of Material.

### Details tab

Details keeps the change notice alert, Manufacturing, configuration parameters, Notes, Files, CAD Model, external source, Risks and Change Notices. It loses the method toolbar and both lists.

### Permissions and locks

The tabs show for employees on Make and Buy and Make parts. A Buy part that opens a tab URL goes to Details. Read-only rules stay: the `parts` update permission, Draft status, the release lock and the change notice draft lock. Controls disable in place.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Layout | Open a line in the content pane | It keeps Properties unchanged and follows the Procedure page |
| Tabs | Two record tabs | Each list gets full width |
| Names | No renames | Existing users keep the words they know |
| Reuse | Export existing forms | They hold many domain rules. A rewrite adds risk |
| Table component | `@carbon/react` table primitives | Reorder needs custom rows. `tables-and-lists.md` allows this for small embedded lists |

## Autonomous Decisions

High-stakes first. None changes the schema, auth, tenancy, a public API or a dependency.

- [x] Scope: part only, or every item type? — **Autonomous:** part only. Tool and Service keep today's editor — the request names the part record, and this keeps the first release reversible (rung 1). **This narrows scope; review it.**
- [x] Save model: autosave everything? — **Autonomous:** no change. Details keeps Save, and Instructions keeps autosave — AGENTS.md says preserve behavior, and no requirement asks for autosave (rung 2). **Review it.**
- [x] Steps layout: list, editor and preview together? — **Autonomous:** keep the existing Steps form at full pane width. Preview stays a tab — the forms hold slide, part and tool rules, and the design keeps Preview in its tab (rung 1). **This leaves the Steps form itself mostly unchanged; review it.**
- [x] Inherited content — **Autonomous:** show procedure content read-only. Show a notice with a link for an Assembly Instruction or an Inspection Plan — the design asks for inherited content, and only procedures have a simple read (rung 5).
- [x] Preview with a linked document — **Autonomous:** show a notice — today's Preview shows the method's steps, which the floor does not get (rung 5).
- [x] Old make route — **Autonomous:** redirect to Bill of Material — existing links must keep working (rung 2).
- [x] CAD model of a sub-assembly — **Autonomous:** show it under the Bill of Material table when `makeMethodId` is a sub-assembly — the make route shows it today (rung 2).
- [x] Method toolbar on Details — **Autonomous:** remove it. Version links in Properties and the New Version redirect go to Bill of Material — the toolbar acts on the lists, and they moved (rung 5).
- [x] Row click — **Autonomous:** the whole row opens the line, and the name is also a link for keyboard use — the design opens a line by clicking its row (rung 1).
- [x] Delete — **Autonomous:** keep immediate delete, in a row menu and in Delete Selected from one selected row up — matches today's list (rung 2).
- [x] Keyboard shortcuts for the new tabs — **Autonomous:** none in this release — free letters are few, and `mod+shift+b` needs a conflict check (rung 5).
- [x] Add a line — **Autonomous:** a `new` route with the existing form. The saved line then opens — a temporary row has no place in a table (rung 5).
- [x] Translations — **Autonomous:** mark every string with Lingui and run extract. Fill locales at commit time, through the `translate` gate (rung 2).

## Acceptance Criteria

1. On SAT-1000, the record tabs show Details, Bill of Material, Bill of Process, then the existing tabs.
2. Bill of Process shows 3 rows with Operation Type, Work Center, Labor and a Procedure badge on row 1.
3. Clicking row 1 opens `/bill-of-process/:id`. The Explorer lists 3 operations, and Properties still shows SAT-1000.
4. Next opens row 2 without a full page reload, and the URL changes.
5. Steps on a procedure-linked operation shows the 5 procedure steps read-only.
6. On a Draft method, a labor time edit saves, and the table shows the new value.
7. Add Operation opens `/new`. Save opens the new operation. The table shows one more row.
8. Bill of Material shows 7 rows with quantity and unit, Method Type and Operation.
9. Editing a line's quantity on a Draft method saves and shows in the table.
10. On an Active method, every edit control is disabled.
11. A tree click on EPS-001 from Bill of Process shows EPS-001's operations and stays on that tab.
12. A link to the old make route lands on Bill of Material for that method.
13. A Buy part has neither tab. Its Bill of Material URL redirects to Details.
14. The Tool page still shows today's cards on Details.
15. Scoped typecheck and unit tests pass, and pages render at 1440, 1024 and 390 px.

## Open Questions

All are resolved above. See Autonomous Decisions.

## Changelog

- 2026-11-05: First version.
- 2026-11-05: Removed the version chips from an opened line.
- 2026-11-05: Removed the number column and the Explorer numbers. Rows no longer show that an operation runs With Previous.
- 2026-11-05: Applied the thermo-nuclear review. See `.ai/plans/2026-11-05-part-bom-bop-tabs-review.md`.
