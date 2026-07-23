# Create a change order

> The entry points that open a change order, the fields on the create form, and how change orders surface back on a part or tool page.

There's no single "new change order" button tucked in one menu. Carbon lets you start a change order from
wherever you notice the change is needed — a standalone form, the part you're looking at, its method version
menu, or a quality issue. Every path lands on the same change-order detail page.

## Entry points

  - **Items → Change Orders → New**: The standalone form. Start here when the change spans several parts or you haven't opened a specific one yet.
  - **Part or Tool header → Create Change Order**: Opens the create form as a modal with the current part or tool pre-attached as the first affected item.
  - **Parts table → row menu → Create Change Order**: A one-click start: mints the change order, attaches that part, and drops you on its detail page.
  - **Method version menu → New Change Order**: On a part's method, the same version menu that holds **New Version** offers **New Change Order** — the natural place to reach for a change while you're looking at the recipe.
  - **Quality issue → Create Change Order**: From a non-conformance, this opens a change order with the issue linked, so the engineering fix is traceable back to the problem that prompted it.

The part-header, parts-table, and method-version entry points all pre-select the part or tool as the change
order's first affected item, so you land ready to pick a change type and edit. The standalone form leaves the
**Affected Parts & Tools** field empty for you to fill.

## The create form

The header form is short — the substance is in the affected items you edit later.

  - **Name**: What this change is, in a line.
  - **Category**: The change-order type, drawn from your configured categories. See `docs/reference/change-orders/setup`.
  - **Reason for Change**: Why the change is needed. Rich text.
  - **Description of Change**: What's changing, in narrative. Rich text.
  - **Owner**: The employee responsible.
  - **Priority**: Low, Medium, or High.
  - **Open Date**: Defaults to today.
  - **Due Date**: Optional target.
  - **Linked NCR**: A non-conformance this change resolves. Pre-filled when you started from a quality issue.
  - **Affected Parts & Tools**: The parts and tools to change. Parts and tools only; you can add more from the detail page later.

Submitting creates the change order, attaches any affected items, and redirects to its detail page at
**"Draft"**.

## Where change orders surface on a part

Change orders don't just live in their own list — they show up on the parts and tools they touch, so nobody
edits a design that's mid-change without seeing it.

- **Open change order alert.** When a part is on one or more change orders that haven't reached **"Done"**,
  its detail page shows a warning: *"This part is on 1 open change order"* (or *"…# open change orders"*),
  with each change order id linked. This is the guardrail against two people revising the same part blind.
- **Change Orders history.** A card lists every change order that has touched the part, newest first, with
  released ones de-emphasized — the full "why did this part change?" trail.
- **Provenance back-link.** A revision or part created by a released change order carries a *"Created by
  CN-…"* reference to the change order that made it.

Each change order gets a per-company readable id like **CN-000001**. That's the id you'll see in the alert,
the history card, and the provenance link.

## Related

  - Change types What you set on each affected item once it's attached.
  - Revise a part The same flow told as a story.
