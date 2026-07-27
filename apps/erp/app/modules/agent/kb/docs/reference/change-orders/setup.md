# Categories & actions

> The two company-scoped lookups that sit alongside change notices — the category list and the reusable action-task templates — plus linking an action task to Linear.

Two configuration lists live next to change notices in the Items nav. Both are company-scoped and edited by
employees with the `parts` permission.

## Change notice categories

**Items → Change Notice Types** holds the values for a change notice's **"Category"** field — the same idea as
issue types in Quality. Carbon seeds eleven to start: *Design Improvement*, *Cost Reduction*, *Quality / Reliability Improvement*, *Supplier / Sourcing Change*, *Material or Component Change*, *Obsolescence / End-of-Life*, *Regulatory / Compliance*, *Safety*, *Manufacturing / Producibility*, *Customer Request*, and *Documentation Error / Correction*. Add,
rename, or remove them to match how your shop classifies changes.

Category is descriptive: it groups and filters change notices, but it doesn't change how release behaves. That
job belongs to the `docs/reference/change-orders/change-types` on each affected item.

## Change notice actions

**Items → Change Notice Actions** holds reusable **action-task templates** — the checklist items a change
notice commonly needs. Carbon seeds seven:

- Engineering Review
- Update Drawings / CAD
- Update BOM / Routing
- Cost Impact Review
- Quality Review
- Inventory Disposition (rework / scrap / use-as-is)
- Notify Affected Parties

A new change notice can seed its task list from the active templates. On the change notice, each task tracks a
status — **Pending**, **In Progress**, **Completed**, or **Skipped** — plus an assignee, due date, and notes.

Tasks are a coordination checklist, not an approval workflow. A task's status never blocks a stage from
advancing or a change notice from releasing — the `docs/reference/change-orders/lifecycle` are the
only gate.

Because tasks are the *workflow* side of a change notice rather than its engineering content, they stay
editable at the **"Implementation"** stage, when the drafts and affected items are already frozen. See
`docs/reference/change-orders/lifecycle`.

## Link a task to Linear

If engineering tracks its work in Linear, an action task can point at the ticket instead of duplicating it.
This works exactly the way it does on a `docs/reference/quality` action tasks — same dialog,
same behavior.

The affordance is a Linear icon on the task row, and it only appears when your company has the `docs/integrations/project-management` connected. Once a task is linked, the icon is replaced by
the ticket's identifier, so you can see at a glance which tasks are being worked outside Carbon.

Opening the dialog gives you two tabs:

  - **Link Existing**: Search your Linear issues and attach one to this task.
  - **Create New**: Create a fresh ticket from the task and attach it in one step.

A linked task shows the ticket's title, identifier, state, and assignee, with a link out to the ticket itself
and an **Unlink** button to break the connection. A task holds at most one ticket per provider — the tabs are
disabled while a link exists, so unlink first if you need to point somewhere else.

Edits to the task's **notes** in Carbon are pushed to the linked ticket's description. In the other direction,
when the ticket changes in Linear, a webhook syncs its **status**, **assignee**, **due date**, and
**description** back onto the Carbon task — so completing the ticket in Linear marks the action task
completed here. Whoever is doing the work never has to update two systems.

The same task row also offers a Jira icon, with the identical Link Existing / Create New dialog and two-way
sync. Jira only shows up when the integration is connected *and* the server has Jira OAuth credentials
configured, so on most installs Linear is the one you'll see.

## Related

  - Create a change notice Where the category is set and tasks are seeded.
  - Lifecycle & release The stages that actually gate a change notice.
  - Project management integrations Connecting Linear and Jira in the first place.
