# Change orders

> How Carbon drafts an engineering change against real methods, reviews it as a diff, and releases it so downstream planning supersedes the versions it replaces.

A **change order** groups the parts and tools whose designs are changing, revises each one on a hidden
draft, and releases them together. It answers "what changed, who owns it, and what does the new version
supersede?" without touching a live method until you release.

The model is deliberately top-down. You pick the affected items first, then edit each item's real
method (its bill of materials and bill of process) inside the change order. Nothing
about the part moves for planning, jobs, or costing until release. Change orders live under **Items → Change
Orders**, and every action is gated by the `parts` permission.

## The affected item is the unit of work

A change order is a header plus a list of **affected items**. The picker accepts **Parts and Tools only** —
materials, consumables, and services carry no engineering revision, so they're excluded. Each affected item
carries its own change type, its own edits, and its own cutover
configuration.

Adding an affected item snapshots the item's live **Active** method into a new **Draft** method stamped with
the change order's id. That draft is hidden from every version switcher, copy-target picker, and MRP, job, or
cost read until release. You edit it with the same **Bill of Material**, **Bill of Process**, and **Part
Properties** editors you use anywhere else.

Carbon does not mirror your edits into shadow tables. An affected item's edits live on an actual make method
whose change-order id is set, which is why the diff is exact and release is just an activation. The draft is
invisible everywhere else precisely because that id is set — clearing it at release is what makes the draft
live.

## Find one in the list

**Items → Change Orders** lists every change order. Because the affected item is the unit of work, each row
**expands** to reveal the parts and tools it changes — one line per affected item, with its change type badge
and, for a Revision or New Part, the old item number arrowed to the new one (**P000123 → P000124**). You see
what a change order touches without opening it.

To find the change orders that touch a specific part, use the **Item** filter. Pick one or more items and the
list narrows to change orders that affect them. The **Items** column that backs the filter is hidden by
default; turn it on from the column toggle if you want it in view or in a CSV export.

## How the pieces fit

  - Create a change order Every entry point — the standalone form, a part or tool header, the parts table, the method version
    menu, and a quality issue — plus how change orders surface back on a part.
  - Change types Version, Revision, and New Part: what each lets you edit and what release creates.
  - Lifecycle & release The five stages, the diff review, the impact panel, and what release actually does.
  - Supersession & cutover How a released revision phases over, and how MRP and Get Method honor it downstream.
  - Categories & actions The change-order category lookup and the reusable action-task templates.

## Related

  - Revise a part The narrative tour: draft a change, review the diff, release, and let supersession carry it downstream.
  - Methods & sourcing Method versions, Draft/Active/Archived, and Get Method — the machinery a change order drives.
