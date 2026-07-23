# Items

> The master record for everything you make, buy, or stock: parts, materials, tools, and more.

An **item** is the master record for anything Carbon tracks: a finished part, a raw material, a tool, a consumable. Orders, methods, jobs, and inventory all point back to it. Its human-facing **part number** is the readable id. The underlying id is an internal key you rarely see.

An item's type, how it's replenished, and how it's tracked decide how it behaves everywhere downstream: whether it can be made or only bought, whether stock is counted, whether each unit needs a serial. Get the item right and the rest of the system follows.

## Fields

  - **Part number**: The readable id; with a non-zero revision it reads as `id.rev`.
  - **Type**: *Part*, *Material*, *Tool*, *Consumable*, *Service*, or *Fixture*.
  - **Replenishment system**: How it's sourced overall: *Buy*, *Make*, or *Buy and Make*.
  - **Default method type**: The default per-line fulfillment: *Purchase to Order*, *Pull from Inventory*, or *Make to Order*.
  - **Tracking type**: *Inventory*, *Non-Inventory*, *Serial*, or *Batch*.
  - **Unit of measure**: The stock unit.
  - **Active**: Whether it can be used on new documents.

**Replenishment system** is the high-level strategy; **default method type** is the line-level default it allows. A *Buy* item defaults to purchasing; a *Make* item can be built to order or pulled from stock. The two are related but distinct.

## Tracking

The tracking type sets how units are counted. *Inventory* items are quantity-tracked stock; *Non-Inventory* items aren't counted; *Serial* items carry one record per unit; *Batch* items are lot-tracked with their own batch numbers and dates.

## Revisions

Each revision of a part is its **own item record**, sharing the same part number but a different revision. A design change creates a new revision rather than rewriting the old one, so jobs built against an earlier revision keep their history.

An item's costing method, one of *Standard*, *Average*, *FIFO*, or *LIFO*, lives on its cost record, not the item itself, and decides how consumption is valued.

## Related

  - Methods & sourcing How an item's bill of materials and routing are defined.
  - Jobs A make-to-order item becomes a job that builds it.
