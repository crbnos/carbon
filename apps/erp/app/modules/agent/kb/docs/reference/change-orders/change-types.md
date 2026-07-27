# Change types

> Version, Revision, Replacement Part, and New Part — the per-affected-item choice that decides what you can edit and what release creates.

Change type is set per affected item (default **Version**) and is the most load-bearing field on the whole
change order. It decides two things at once: what you're allowed to edit on the draft, and what release
creates from it. Two axes tell the four types apart: is there a **predecessor** item, and does the result keep
the **same part number**.

## The four types

| Change type | You edit | Release creates | Auto-supersession |
| --- | --- | --- | --- |
| Version | BoM and BoP on the **same item** | A new **method version**; the prior Active version is archived | None |
| Revision | Attributes, documents, BoM and BoP | A new **item revision** (same Part ID, next revision) | Old revision → new revision |
| Replacement Part | Attributes, documents, BoM and BoP | A **new part number** derived from the affected part | Affected part → new part |
| New Part | Attributes, documents, BoM and BoP | A **net-new part** minted under the change order | None — it has no predecessor |

Don't conflate them. A **Version** produces a new method version on the *same* item row, so existing stock and
item history are untouched and nothing is superseded. A **Revision** and a **Replacement Part** each mint a
*new* item derived from the affected part and leave the old one intact, so each auto-writes a
supersession from old to new. A **New Part** has no predecessor at all — it introduces a brand-new
part, so it supersedes nothing. See `docs/reference/change-orders/supersession`.

## When to use which

- **Version** — the design is the same part, made a little differently. A tweaked operation, a swapped
  component, a corrected quantity. There's no drawing-revision story and no reason to phase over stock.
- **Revision** — the part is formally revising (new drawing revision, new dimension) and you want old and new
  to coexist while stock phases over. This is the everyday engineering-change case. You can name the revision
  (for example `A`) when you add the item, or leave it blank to take the next revision automatically.
- **Replacement Part** — the change warrants a new part *number*, derived from the old one, with the old part
  superseded by the new. The 1:1 replacement.
- **New Part** — you're introducing a genuinely new part under change control, with no old part behind it.
  Nothing is superseded. This is also how a consolidation is modeled: when several components collapse into
  one, the consolidated "1" is added as a **New Part** and the old lines are dropped from the parent
  assembly's draft BoM.

Because a New Part is net-new by construction, you can't switch it to another change type after you add it,
and it shows no cutover card. The other three types can be switched, but switching discards the draft and mints
a fresh one, so any edits are reset.

## What each type gates

Change type also controls the editable surface on the affected item:

- **Version** exposes the **Bill of Material** and **Bill of Process** editors on the draft method.
- **Revision**, **Replacement Part**, and **New Part** add **Part Properties** (attributes) and documents on
  top of BoM and BoP, because each is producing a genuinely new item, not just a new recipe.

The **Add Affected Item** picker accepts **Parts only** — the existing-item selector is filtered to Parts, and
the New Part mini-form always mints a Part. There's no Tool path in the change-order UI.

A purchased (**Buy**) item has no bill of materials or process, so a **Version** is meaningless for it. The
picker hides **Version** for Buy items and restricts a Version's item selector to **Make** parts; adding a Buy
item defaults its change type to **Revision** instead.

## Add a net-new part

Choosing **New Part** in the change-type selector swaps the affected-item modal to a short mint-a-part form:

  - **Part Number**: The new part's readable id. Type <code>...</code> to pull the next id in the Part sequence.
  - **Name**: What the part is.
  - **Replenishment System**: Buy, Make, or Buy and Make. Defaults to **Make**.
  - **Tracking Type**: Inventory, Non-Inventory, Serial, or Batch. Defaults to **Inventory**.

Submitting mints an inactive Part under the change order and adds it as a **New Part** affected item. It stays
hidden until release reveals it.

## Supplier parts on a purchased line

A **Revision**, **Replacement Part**, or **New Part** whose draft item is purchased (**Buy** or **Buy and
Make**) gets a **Supplier Parts** grid on its line, right alongside the properties editor. You use it to set up
how the new part or revision is bought: **Supplier**, **Supplier ID** (the supplier's own part number), **Unit
Price**, **Unit of Measure**, **Minimum Order Quantity**, and **Conversion Factor**. Add, edit, and delete rows
here the same way you would on a live part.

A draft item starts with **no** supplier parts — the source item's suppliers aren't copied onto the draft. If a
purchased Revision, Replacement Part, or New Part releases with an empty grid, the new part is stocked but has
no way to buy it, so a purchase order can't reference it. Fill the grid on the line first. The suppliers you add
show up in the change order's `docs/reference/change-orders/lifecycle`
as additions.

## Related

  - Lifecycle & release What release does with each change type.
  - Methods & sourcing Method versions and the Draft/Active/Archived states a change order drives.
