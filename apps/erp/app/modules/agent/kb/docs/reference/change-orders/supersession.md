# Supersession & cutover

> How a released Revision or New Part phases over, the cutover fields you tune per item, and how MRP and Get Method honor supersession downstream.

For every **Revision** and **New Part** affected item, release auto-writes a supersession from
the old item to the new one. You don't create it by hand — you only tune *how* the phase-over behaves, per
affected item, through the cutover fields. A **Version** change type supersedes nothing, because it's the same
item.

## Cutover fields

Set these on the affected item before you release.

  - **Supersession Mode**: How planning treats the old item. See the modes below. Defaults to **Consume First**.
  - **Discontinuation Date**: When the old item stops being usable. Empty means no planned discontinuation.
  - **Successor Effectivity Date**: When the successor becomes effective for redirect. Empty means effective immediately at release.

## Supersession modes

The supersession mode controls what downstream planning does with the old
item:

| Mode | Behavior |
| --- | --- |
| Consume First | Exhaust on-hand of the old item, then redirect new demand to the successor. |
| Prefer New | Redirect new demand to the successor immediately. |
| Stock Only | Keep only a minimum service reserve of the old item; no production use. |
| No Stock | Drop the old item from planning entirely. |

Those two modes tell planning to route the old item's demand — times its conversion factor — to the
successor. Stock Only and No Stock govern the old item's own stocking rather than redirecting to a successor.

## How downstream honors it

Once a supersession is effective (on or after its successor-effectivity date), two systems act on it:

- **MRP** redirects planned demand for the old item to the successor, applying the conversion factor and
  collapsing multi-hop chains (if A was superseded by B and B by C, demand routes straight to C).
- **Get Method** substitutes the successor onto Buy and Pull bill-of-materials lines when a new job is
  created, recording the source item so the substitution is traceable.

Existing stock stays on the old item, and jobs already created keep the exact materials and method version
they were built against. Supersession only steers *forward* planning — a job created after the successor's
effectivity date picks up the new item; one created before it does not shift. That's what makes releasing safe
on a busy floor.

## Related

  - Reordering & planning How the replenishment system and reordering policy read supersession.
  - Change types Which change types write a supersession, and which don't.
