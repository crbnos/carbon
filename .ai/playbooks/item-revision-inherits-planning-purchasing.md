# Item revision inherits planning, purchasing and supplier parts

Last tested: 2026-10-05
Routes: /x/part/{itemId}/details · /x/part/{itemId}/purchasing · /x/part/{itemId}/planning ·
/x/part/{itemId}/costing · /x/items/change-notice/{coId}/{affectedId}/details

## Prerequisites
- A demo dataset is applied (satellite works): it seeds Buy parts with one supplier part and
  one price break each (BRG-6201, RW-010, ...) and Make parts with a BOM (PCB-ADCS-R1).
- Two locations exist, so the planning copy can be checked per location.
- No "Buy and Make" part is seeded: test the purchasing/planning copy on a Buy part and the
  manufacturing copy (Batch Size, Scrap Percent, Lead Time, BOM) on a Make part.

## Steps

### 1. Give the source recognisable values
- Buy part, **Purchasing** tab: open the first combobox (Preferred Supplier), pick the option;
  fill the Lead Time textbox; `requestSubmit` the form that holds `input[name=preferredSupplierId]`.
  Toast: "Updated part purchasing".
- **Planning** tab: fill Accumulation Period, Safety Stock, Minimum Order Quantity; blur;
  `requestSubmit` the form that holds `input[name=reorderingPolicy]`. Toast: "Updated part planning".
  The form edits ONE location (the selected one); the other keeps its values.
- **Accounting** tab (`/costing`): open the Item Group combobox, pick a group; `requestSubmit` the
  form that holds `input[name=itemPostingGroupId]`. Toast: "Updated part costing".
- Make part, **Details** tab: the Manufacturing card has Batch Size, Scrap Percent, Lead Time;
  `requestSubmit` the form that holds `input[name=lotSize]`. Toast: "Updated part manufacturing".

### 2. New Revision
- On the part page, the left explorer has **Revisions N** followed by a **Create** button (on a
  Make part it is under the **Used In** tab). Click Create.
- Modal "New Revision": fill the textbox with the label; `requestSubmit` the form that holds
  `input[name=copyFromId]`. Action is `/x/items/revisions/new`.
- Verify: redirect to `/x/part/{newItemId}/details`; Purchasing, Planning and the Manufacturing
  card show the source's values; the Supplier Parts grid lists the source's supplier.

### 3. Duplicate label
- Create the same label again. Verify: stays on the page, toast "Failed to create revision".

### 4. Delete the revision
- Header **More options** → **Delete Part** → dialog "Delete {id}" → `requestSubmit` its form.
- Verify: redirect to `/x/items/parts`, toast "Successfully deleted item".

### 5. Revision through a change notice
- In the New Revision modal click the **Open a change notice** switch before submitting. The
  form action becomes `/x/items/change-notice/new-from-item/{itemId}`.
- Verify: redirect to the new change notice, toast "Change notice created"; on the affected
  item's line the Supplier Parts grid is pre-filled and **Changes** reads "No changes yet."
- Edit the draft's supplier part: open `{line url}/{supplierPartId}` (drawer "Edit Supplier Part"),
  fill Unit Price / Supplier Part ID, `requestSubmit` the form that holds `input[name=supplierId]`.
  Verify: Changes → Supplier Parts shows one **Modified** entry with old → new values.

### 6. Discard the draft
- Explorer row → **More** → **Delete** (acts at once, no dialog), or header **More options** →
  **Delete Change Notice** → confirm. Verify the draft revision item no longer exists.
- Change type: pick another type in the **Change type** combobox, then `requestSubmit` the form
  whose submit button reads **Apply** (the selection alone does nothing).

## Selector Notes
- The Revisions **Create** button is the `Create` that directly follows `Revisions N` in the
  snapshot; the topbar also has a `Create` button.
- The page can still be rendering right after `networkidle`: wait ~1.5 s before grepping the
  snapshot for the Revisions section.
- The Changes card labels a supplier by raw id for a moment after load, then by name once the
  suppliers store hydrates. Re-snapshot before reading it.
- Confirm dialogs: find the dialog's button whose text starts with "Delete" and `requestSubmit`
  its form.

## DB verification (the real proof)
```sql
-- source vs new revision: replenishment, per-location planning, item group, suppliers
select i.revision, r."lotSize", r."scrapPercentage", r."leadTime", r."preferredSupplierId"
  from "itemReplenishment" r join item i on i.id = r."itemId" where r."itemId" in (:src, :rev);
select l.name, i.revision, p."reorderingPolicy", p."demandAccumulationPeriod",
       p."demandAccumulationSafetyStock", p."minimumOrderQuantity"
  from "itemPlanning" p join item i on i.id = p."itemId" join location l on l.id = p."locationId"
  where p."itemId" in (:src, :rev) order by 1, 2;
select i.revision, sp."supplierId", sp."unitPrice",
       (select count(*) from "supplierPartPrice" p where p."supplierPartId" = sp.id) as breaks
  from "supplierPart" sp join item i on i.id = sp."itemId" where sp."itemId" in (:src, :rev);
```

## Common Failures
- Saving an inherited supplier part whose unit of measure was empty writes "EA", so the change
  notice diff also lists "Purchasing unit — → EA" next to the field you meant to change.
- Deleting a supplier part that has price breaks fails with "Failed to delete supplier part"
  (`supplierPartPrice → supplierPart` is ON DELETE RESTRICT; `deleteSupplierPart` is a plain delete).
- Deleting a change notice whose New Part sits on another affected item's draft BOM fails with
  "Failed to delete change notice" (`methodMaterial.itemId → item` is ON DELETE RESTRICT). Nothing
  is half-deleted. Remove the BOM line first.
