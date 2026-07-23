# Lifecycle & release

> The five change-order stages, the impact panel, the diff review, and exactly what release does when a change order reaches Done.

A change order advances forward one stage at a time. There's no approval toggle and no going back — the
stages *are* the workflow, and the change order is its own release gate.

## The five stages

  - **Draft**: The change order is being written. Pick affected items, set change types, and edit each draft method. Nothing is broadcast.
  - **Start**: Work is underway. Advancing to Start broadcasts a notification to the team.
  - **Engineering Complete**: The design edits are finished and ready for implementation review. Silent, no broadcast.
  - **Implementation**: The release stage. The **"Release"** action is available here; it reviews every affected item's diff and applies the change. Advancing here broadcasts.
  - **Done**: Released and locked. The change order becomes a read-only historical record; broadcasts on entry.

The **"Start"**, **"Implementation"**, and **"Done"** transitions each notify the team; **"Engineering
Complete"** is silent. Once a change order reaches **"Done"** it is locked — every editor is read-only.

## The impact panel

Alongside the affected items, a change order shows an **Impact** panel: a where-used tree for each affected
item across jobs, job materials, method materials, purchase orders, receipts, quotes, issues, maintenance,
and assembly instructions.

The panel is there so you can see what a change touches before you commit, not to gate you. Nothing in it
stops a release; the copy says as much: *"Where the affected items are used across the system. Informational —
nothing here blocks releasing."*

## Review the changes, then release

You don't have to wait for release to see what a change order does. The overview page carries a **Changes**
card, between the description and the action tasks, that rolls up **every** affected item's diff as you author
it — each item labeled with its change type, its diff rendered read-only. It's the same view the release dialog
shows, available the whole time so you can check your work before you commit. An item with nothing edited yet
reads *"No changes yet."*

Release itself lives on the change order at **"Implementation"**. The **"Release change order"** dialog lays out
that same per-item diff one more time before you commit — *"Review each item's changes, then confirm —
releasing can't be undone."*

Each item's diff compares its edited draft against the method it was snapshotted from, across four sections:

- **Bill of Materials** — added, removed, and modified BoM lines, field by field.
- **Bill of Process** — added, removed, and modified operations and their steps, parameters, and tools.
- **Properties** — changed item fields (name, description, unit of measure, tracking type, replenishment
  system, and the rest), one row per changed column.
- **Supplier Parts** — for a purchased Revision or New Part, the `docs/reference/change-orders/change-types`, each listed as an
  addition with its part number, unit price, min order qty, order multiple, conversion factor, and purchasing
  unit. A draft starts with none, so every supplier you add shows here.

There's no shadow copy of your edits to drift out of sync. You edited an actual draft method, so the diff is
simply that draft compared against the live one it came from. What you review is exactly what releases.

## What release does

On confirm, Carbon walks the affected items and, per `docs/reference/change-orders/change-types`:

1. **Activates the draft method** — it becomes the new **Active** version and the prior Active version is
   **Archived** (kept as history, never deleted).
2. **Reveals the new item** — for a Revision or New Part, the newly created item is switched live and stamped
   with the change order id. A Version has no new item.
3. **Writes the supersession** — for a Revision or New Part, from the old item to the new one, using that
   affected item's cutover settings. See `docs/reference/change-orders/supersession`.

When every affected item is processed, the change order flips to **"Done"**.

Each affected item is marked done the moment its draft's change-order id is cleared, so a re-run skips items
already released and resumes at the first unreleased one. The final flip to **"Done"** is a compare-and-swap
on the **"Implementation"** status, so two people releasing at once can't double-apply.

## Parallel change orders on the same part

Two change orders can revise the same part at once. Each drafts its own method version, and Carbon steps
around version collisions so they don't clobber each other. Whichever releases second activates on top of the
first, and the earlier version is archived as history rather than overwritten — so no work is lost. There's no
merge-conflict step to resolve.

## Related

  - Supersession & cutover How a released revision phases over downstream.
  - Revise a part The release flow told as a story.

## Troubleshooting

### "Cannot modify a completed change order."
The change order is at **"Done"** (or cancelled) and is a locked, read-only historical record — nothing reopens it. To make further changes to the same parts, raise a new change order; the released methods and items are its starting point.

### Release button not available
The **"Release"** action only appears at the **"Implementation"** stage. If the user can't find it, check the change order's current stage — it must be advanced (one stage at a time, no skipping) to Implementation first.
