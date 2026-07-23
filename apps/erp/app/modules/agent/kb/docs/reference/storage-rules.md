# Storage rules

> Predicate guards that validate inventory transactions: block with an error, or warn and let the user continue.

A **storage rule** is a guard that runs when an inventory transaction posts. It checks the line against a
condition you define and, if the condition fails, either **blocks** the transaction or **warns** and lets the
user acknowledge and continue. Rules attach to **items** or to **work centers**.

For example, to keep batch chemicals out of ambient bins: target **items** in your chemicals group, fire on
**receipt** and **place** (put-away), and require `storageUnit.storageTypeId` `eq` your cold-storage type.
Severity **error**, message `{item.id} must be stored in cold storage`. Receive that item into the wrong
bin and the post is stopped with exactly that message.

Storage rules are a **validation** layer. A rule never transforms data, sets defaults, or computes a
price. Its only output is a message and a severity.

## What a rule checks

Each rule holds a small **condition tree**, a match kind over one or more field/operator/value rows:

- **Match kind**: `all` (every condition must hold), `any` (at least one), or `none` (none may hold).
- **Field**: chosen from a fixed registry: item facts (`item.type`, `item.replenishmentSystem`,
  `item.itemTrackingType`, custom fields), storage location (`storageUnit.storageTypeId`,
  `storageUnit.locationId`), work-center facts, and the line's `transaction.quantity`.
- **Operator**: `eq`, `neq`, `in`, `notIn`, `isSet`, `isNotSet`, `gt`, `lt`.

The **message** shown on a violation supports tokens like `{item.id}` and `{transaction.quantity}`, so the
text can name the offending line. The rule "passes" when its conditions hold; a violation fires when they
don't.

Aside from the `isSet` / `isNotSet` checks, a condition pointing at a field that has **no value** fails as a
*"…is required"* violation. So the same rules double as presence checks (for instance, require a lot number
before a shipment can post).

## Operators

| Operator | Meaning |
| --- | --- |
| `eq` · `neq` | equals · does not equal |
| `in` · `notIn` | value is · is not in a list |
| `gt` · `lt` | greater than · less than |
| `isSet` · `isNotSet` | field has · does not have a value |

## Where rules fire

A rule lists the **surfaces** (transaction types) it applies to. The available surfaces depend on the
target:

| Target | Surfaces |
| --- | --- |
| Item | receipt, shipment, stockTransfer, warehouseTransfer, inventoryAdjustment, place, pick |
| Work center | operationStart, operationFinish, materialIssue, materialReceive |

Rules are evaluated server-side as the transaction posts, before any accounting or stock movement is
written. A blocked transaction writes nothing.

## Block or warn

| Severity | Behavior |
| --- | --- |
| `error` | Blocks the transaction until the condition is satisfied. |
| `warn` | Surfaces the message but lets the user **acknowledge and continue**. |

An `error` always blocks. A `warn` blocks only until the user acknowledges it, then the same submit goes
through — useful for "are you sure?" guardrails that shouldn't hard-stop the floor.

For instance, a `warn` rule on **inventory adjustments** where `transaction.quantity` `gt` `1000`, with the
message `Large adjustment — confirm the count`, lets the count post once the user acknowledges it while still
flagging the outlier.

## Scope and assignment

A rule reaches the lines it applies to in one of two ways:

- **By filter**: item-target rules can scope to **item types** and/or **item groups**, combined with OR or
  AND. An empty filter matches **every** item.
- **By assignment**: pin a rule to a specific item from the item's **Rules** tab, or to a specific work
  center. Work-center rules can also be set to apply to all work centers.

## Rule fields

  - **Name**: A unique name for the rule.
  - **Severity**: `error` (block) or `warn` (acknowledge and continue).
  - **Conditions**: The match kind plus the field / operator / value rows.
  - **Message**: Shown on a violation; supports `{token}` interpolation.
  - **Surfaces**: Which transactions the rule fires on.
  - **Target**: `item` or `workCenter`.
  - **Item filters**: Item types and/or groups to scope an item rule (empty = all items).
  - **Active**: Whether the rule is currently evaluated.

## Where to manage them

Storage rules live in the **Inventory** area, under **Storage Rules**. Create, edit, and toggle them there.
To attach an existing rule to a single item, use the **Rules** tab on that item.

Storage rules are an **Enterprise** capability, gated to the **Business** plan. On other
plans the screen shows an upgrade prompt and no rules are evaluated.

## Related

  - Items The most common rule target: scope by item type or group, or assign per item.
  - Inventory Storage rules run on inventory transactions: receipts, shipments, transfers, picks.
  - Work centers The other target: guards on operation start/finish and material issue/receive.
  - Shelf life The other inventory guard: date tracked stock and block it once expired.

## Troubleshooting

Storage-rule violations carry **custom, company-authored messages** — there is no fixed error string to match. If a user pastes an unfamiliar error from posting a receipt, shipment, transfer, adjustment, pick, or a shop-floor operation step, and it reads like a business rule ("must be stored in cold storage", "lot number is required", quantities named in the text), it is very likely a storage rule firing.

How to resolve one:
1. Find the rule: **Inventory → Storage Rules** — the rule's *Message* column will match the pasted text (token values like the item id filled in).
2. If the transaction is wrong, fix the data the rule checks: the storage unit chosen, the missing lot number, the quantity.
3. If the rule is wrong or too strict, edit its conditions, change its severity from `error` to `warn`, or toggle it off (*Active*).
4. A `warn`-severity violation isn't an error — the user can acknowledge the dialog and resubmit; it goes through.

A violation ending in "…is required" means the rule checked a field that has no value on the line (see the presence-check callout above) — supply the value rather than changing the rule.
