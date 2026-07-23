# Categories & actions

> The two company-scoped lookups that sit alongside change orders — the category list and the reusable action-task templates.

Two configuration lists live next to change orders in the Items nav. Both are company-scoped and edited by
employees with the `parts` permission.

## Change order categories

**Items → Change Order Types** holds the values for a change order's **"Category"** field — the same idea as
issue types in Quality. Carbon seeds three: *Design improvement*, *Obsolescence*, and *Cost reduction*. Add,
rename, or remove them to match how your shop classifies changes.

Category is descriptive: it groups and filters change orders, but it doesn't change how release behaves. That
job belongs to the `docs/reference/change-orders/change-types` on each affected item.

## Change order actions

**Items → Change Order Actions** holds reusable **action-task templates** — the checklist items a change
order commonly needs. Carbon seeds seven:

- Engineering Review
- Update Drawings / CAD
- Update BOM / Routing
- Cost Impact Review
- Quality Review
- Inventory Disposition (rework / scrap / use-as-is)
- Notify Affected Parties

A new change order can seed its task list from the active templates. On the change order, each task tracks a
status — **Pending**, **In Progress**, **Completed**, or **Skipped** — plus an assignee, due date, and notes.

Tasks are a coordination checklist, not an approval workflow. A task's status never blocks a stage from
advancing or a change order from releasing — the `docs/reference/change-orders/lifecycle` are the
only gate.

## Related

  - Create a change order Where the category is set and tasks are seeded.
  - Lifecycle & release The stages that actually gate a change order.
