# Create a change notice

> The entry points that open a change notice, the fields on the create form, and how change notices surface back on a part or tool page.

There's no single "new change notice" button tucked in one menu. Carbon lets you start a change notice from
wherever you notice the change is needed — a standalone form, the part you're looking at, its method version
menu, or a quality issue. Every path lands on the same change-notice detail page.

## Entry points

  - **Items → Change Notices → New**: The standalone form. Start here when the change spans several parts or you haven't opened a specific one yet.
  - **Part or Tool header → Create Change Notice**: Opens the create form as a modal with the current part or tool pre-attached as the first affected item.
  - **Parts table → row menu → Create Change Notice**: A one-click start: mints the change notice, attaches that part, and drops you on its detail page.
  - **Method version menu → New Change Notice**: On a part's method, the same version menu that holds **New Version** offers **New Change Notice** — the natural place to reach for a change while you're looking at the recipe.
  - **Quality issue → Create Change Notice**: From a non-conformance, this opens a change notice with the issue linked, so the engineering fix is traceable back to the problem that prompted it.

The part-header, tool-header, parts-table, and method-version entry points all pre-select that part or tool as
the change notice's first affected item, so you land ready to pick a change type and edit. The standalone form
starts with no affected items — you add them on the detail page.

## The create form

The header form is short — the substance is in the affected items you edit later.

  - **Name**: What this change is, in a line.
  - **Category**: The change-notice type, drawn from your configured categories. See `docs/reference/change-orders/setup`.
  - **Reason for Change**: Why the change is needed. Rich text.
  - **Description of Change**: What's changing, in narrative. Rich text.
  - **Owner**: The employee responsible.
  - **Priority**: Low, Medium, High, or Critical.
  - **Open Date**: Defaults to today.
  - **Due Date**: Optional target.

The form has no affected-items field — you add those on the detail page after creating. When you start from a
part, tool, or quality issue, that source is carried silently onto the new change notice (the part or tool as a
pre-attached affected item, the non-conformance as the linked issue). Submitting creates the change notice,
attaches any pre-selected item, and redirects to its detail page at **"Draft"**.

Change notices are gated by the **Parts** permission: creating one needs create access on Parts, and
advancing or releasing needs update access. If someone can manage parts, they can manage change notices.

## Where change notices surface on a part

Change notices don't just live in their own list — they show up on the parts and tools they touch, so nobody
edits a design that's mid-change without seeing it.

- **Open change notice alert.** When a part is on one or more change notices that haven't reached **"Done"**,
  its detail page shows a warning: *"This part is on 1 open change notice"* (or *"…# open change notices"*),
  with each change notice id linked. This is the guardrail against two people revising the same part blind.
  It's informational, not a lock — `docs/reference/change-orders/lifecycle` are allowed.
- **Change Notices history.** A card lists every change notice that has touched the part, newest first, with
  released ones de-emphasized — the full "why did this part change?" trail.
- **Provenance back-link.** A revision or part created by a released change notice carries a *"Created by
  CN-…"* reference to the change notice that made it.

Each change notice gets a per-company readable id like **CN-000001**. That's the id you'll see in the alert,
the history card, and the provenance link.

The feature used to be called a change order and numbered **ECO-000001**. Only *new* records pick up the
**CN-** prefix — existing ids are left exactly as they were, because they're audit trail and are quoted in
drawings, emails, and customer correspondence. So a mature company will see both **ECO-000042** and
**CN-000043** in the same list. They're the same kind of record.

## Related

  - Change types What you set on each affected item once it's attached.
  - Revise a part The same flow told as a story.
