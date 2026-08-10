# Pricing rules and overrides

> How Carbon resolves the price on a line, from base price through overrides and rules.

When you add an item to a quote line or a sales order line, Carbon doesn't just copy the item's list price. It runs a resolution engine: it starts from a base price, applies any customer-specific override, then layers on discount and markup rules, and records the whole computation as a trace on the line. Two mechanisms feed that engine — price overrides (per-customer negotiated prices with quantity breaks) and pricing rules (company-wide discount/markup logic). This page covers both, and exactly what wins when several apply.

## Pricing rules

A **pricing rule** is a company-scoped rule that adjusts a price up or down. Each rule is a `Discount` or a `Markup`, expressed as either a `Percentage` or a `Fixed` amount, and it only fires when the line matches the rule's conditions.

  - **Rule type**: `Discount` (lowers the price) or `Markup` (raises it).
  - **Amount type**: `Percentage` or `Fixed`. A percentage is stored as a fraction from 0 to 1 (10% is `0.10`), so the form caps it at 100%.
  - **Amount**: The discount/markup value. For a percentage, the fraction of the running price; for fixed, an absolute amount.
  - **Priority**: Higher priority wins among discounts and orders the markup stack. Defaults to `0`.
  - **Min / max quantity**: The line quantity range the rule applies to.
  - **Customers / customer types**: Restrict the rule to specific customers or customer types. Empty means all.
  - **Items / item posting group**: Restrict to specific items or an item posting group. Empty means all.
  - **Valid from / valid to**: The date window the rule is active in. Empty bounds are open-ended.
  - **Active**: Inactive rules are skipped without being deleted, preserving them for audit.

A rule matches a line only when every set condition holds: the quantity is within `min`/`max`, the date is inside the valid window, and the item and customer fall inside the item/customer restrictions (empty restriction means no restriction). Only matching, active rules go into the calculation.

A `Percentage` amount is a fraction between 0 and 1 (`0.10` for 10%). The rule form rejects anything above 1. If you enter 15 expecting 15%, that's a 1500% adjustment.

## Price overrides

A **price override** pins a negotiated price for a specific item, optionally with quantity breaks. Unlike a rule, an override replaces the base price outright rather than adjusting it. Overrides are scoped one of three ways, and a single override targets exactly one scope:

- **Customer** — this item, this customer.
- **Customer type** — this item, everyone of this customer type.
- **All customers** — this item, every customer (both customer and customer type left blank).

An override can't set both a customer and a customer type; the database enforces the exclusive scope. Each override carries a list of **quantity breaks** — rungs of `quantity` → `override price`. For a given line quantity Carbon picks the highest break whose quantity is at or below the ordered quantity. Order eight when the rungs are 1, 5, and 10, and you get the price on the 5-rung.

  - **Item**: The item this override prices.
  - **Customer**: Scope to one customer. Mutually exclusive with customer type.
  - **Customer type**: Scope to a customer type. Mutually exclusive with customer.
  - **Quantity breaks**: One or more `quantity` → `override price` rungs. Duplicate quantities are rejected.
  - **Apply rules on top**: When on (the default), pricing rules still layer onto the override price. When off, the override price is final and rules are skipped.
  - **Valid from / valid to**: The date window the override is active in.
  - **Active**: Inactive overrides are skipped but retained for history.

You can seed one customer's or type's price list from another with **Duplicate price list**, choosing a `skip` or `overwrite` strategy for items the target already prices.

An override sets the starting price directly. Whether rules then adjust it is governed by the override's `Apply rules on top` flag, per override — not a global setting.

## How the engine picks a price

Resolution runs top to bottom. The result, plus every step, is stored on the line as a **price trace**, and the line records which `pricing rule` (if any) drove the final number.

**Start from the base price.** The item's unit sale price, or the cost-rollup price the quote already computed. Trace source: `Base`.

**Apply the best-matching override, if any.** Carbon checks the three scopes in strict precedence and commits to the first that yields a break: **customer override, then customer-type override, then all-customers override.** Once a scope matches, it never falls through to a lower one. If the ordered quantity is below the override's smallest break, that scope doesn't match and Carbon tries the next. The winning override sets the starting price. Trace source: `Override`, `Type Override`, or `All Override`.

**Layer on pricing rules**, unless the winning override set `Apply rules on top` to off. All matching active rules apply here, in the order below. Trace source: `Rule`.

**Clamp and record.** A negative result is floored at zero, and the final price is written to the line along with the full trace.

So the precedence is: **customer override > customer-type override > all-customers override > base price**, and then rules run on top of whichever starting price won.

### What wins when rules collide

Discounts and markups combine differently, and this is the part that surprises people:

- **Discounts don't stack — the single highest-priority discount wins.** When several discount rules match, Carbon ranks them by priority (ties broken by the larger effective amount) and applies **only the top one**. The rest are discarded. You never get two discounts on the same line.
- **Markups stack and compound.** Every matching markup rule applies, in priority order, each computed against the already-adjusted running price. A 10% markup after a 20% markup compounds, it doesn't simply add.

Discounts are applied first, then the markup stack, then the zero floor.

If a customer qualifies for both a 10% and a 15% discount rule, they get 15% only — never 25%, and never both applied in sequence. Markups are the opposite: all of them apply, compounding.

Resolution runs when the item or quantity changes on a line and fills in the unit price. It's a starting point you can still edit by hand; the trace records how the suggested number was reached.

## Where it applies

The same engine prices both surfaces. On a **quote line** it runs during cost rollup and re-price. On a **sales order line** the line form calls the same resolution as you pick an item or change the quantity, filling the unit price and storing the trace. Both line types carry the resolved price and its provenance, so a price traces back to the exact override and rule that produced it.

There's no separate "price list" document in Carbon — the price list is simply the set of overrides scoped to a customer or customer type, and the resolution is computed in the application, not in the database.

## Related

  - Quotes Where negotiated pricing is first recorded, with quantity breaks per line.
  - Sales orders The confirmed order whose lines carry the resolved unit price.

## Troubleshooting

Exact form-validation and gates for pricing rules and price overrides.

### "Percentage must be between 0% and 100%"
On a pricing rule with `Amount type` = `Percentage`, the amount is stored as a fraction between 0 and 1, so the validator rejects anything above 1 (100%). If you meant 15%, enter `0.15`, not `15` — entering `15` is a 1500% adjustment and fails this check.

### "Duplicate quantity across breaks"
A price override's quantity-break table has two rungs with the same quantity. Each break must have a unique quantity — merge or renumber the duplicate rung.

### "Cannot set both Customer and Customer Type" / "Cannot set both customerId and customerTypeId"
A price override targets exactly one scope. You set both a customer and a customer type on the same override. Clear one — leave both blank only for an all-customers override. (The first string is the form message; the second is the service-level guard.)

### "At least one break is required"
A price override was saved with no quantity breaks. Add at least one `quantity` → `override price` rung.

### "Valid From must be on or before Valid To"
The override or rule has a `Valid from` date later than its `Valid to` date. Fix the window so from is on or before to, or clear one bound to make it open-ended.

### "Please select a target scope"
Duplicate price list was submitted without picking a target customer or customer type to copy into. Choose the target scope.

### Why did pricing rules not apply to an override price?
The winning override has `Apply rules on top` set to off, which makes the override price final and skips all rules for that scope. Turn `Apply rules on top` on if you want discounts/markups to still layer on. Note also that a rule only fires when the line falls inside its quantity range, date window, and item/customer restrictions — an out-of-window rule is silently skipped, not an error.

### Why can't I edit a price override's Valid To or Active fields?
Those lifecycle fields lock once the override is created unless you have the sales delete permission. Editing a rule or override otherwise needs sales update; creating one needs sales create.
