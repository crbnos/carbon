# Methods & sourcing

> How Carbon decides whether each part is made, bought, or pulled from stock, and how a job gets its own copy of the recipe.

A part's **manufacturing method** is its recipe: the **method materials** (its bill of materials) and the
**method operations** (its routing). Every made part has one, and it's where the answer to "how is this
built?" actually lives.

## Method type

Every item carries a **method type** that routes it down one of three paths. You set it on the item; every
bill of materials that uses the item mirrors it.

| Method type | What happens |
| --- | --- |
| Make to Order | Manufactured in-house. Becomes its own job with a routing. |
| Purchase to Order | Purchased. Flows through purchasing as a purchase order. |
| Pull from Inventory | Pulled from stock when its parent is built. |

The method type lives on the **item**, not on each BoM line. Change it once and it cascades to every
method that references the part — draft methods only; active and archived methods stay frozen.

## Method type vs replenishment system

These are two different questions, and Carbon keeps them separate:

- **Method type** answers *how does this part get into its parent?* Make to Order, Purchase to Order, or Pull from Inventory.
- **Replenishment system** answers *how is this part replenished overall, and which planning queue does it
  land in?* `Buy`, `Make`, or `Buy and Make`.

A part can be made for one parent and pulled from stock for another; the replenishment system is what
planning reads to decide between a job and a purchase order.

## Kit or subassembly

A **Make to Order** item inside a bill of materials is one of two things:

| | Subassembly | Kit |
| --- | --- | --- |
| Built as | its own job + routing | nothing separate |
| Components | consumed by the subassembly job | issued together into the parent job |
| Use when | the thing is genuinely manufactured | a group of parts always goes in as a set |

## Get Method

When you create a job, Carbon runs **Get Method**. It copies the part's method into a job-specific copy.
The job edits that copy; the part master is never touched silently. Push a proven change back up and the
next job inherits it.

Methods are versioned: **Draft**, **Active**, or **Archived**. Only a Draft is editable; an Active method
is frozen so jobs already running against it don't shift mid-build.

## Related

  - Inside the build See method types, kits, and Get Method in the story of a robot build.
  - Reordering policy How the replenishment system pairs with a part's reordering policy.

## Troubleshooting

### "An item cannot be added to itself."
A bill of materials line was set to the same item as the parent being made — a self-reference. Pick a different component item.

### "Method tree not found"
Creating a job or quote method found no method to copy: the item has no **Active** make method. Open the item's methods, activate a version, and retry.

### "Cannot override method of configured item"
The target item requires configuration, so a plain method copy can't overwrite its (generated) method. Change the method through the item's configuration instead, or clear the requires-configuration flag if it's set by mistake.

### "Failed to get make methods"
The source item for a method copy has no make method to copy from. Create and activate a method on the source item first.
