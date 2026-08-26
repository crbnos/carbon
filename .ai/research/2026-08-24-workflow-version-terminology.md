# How other workflow builders name version states

Research date: 2026-08-24. Question: Carbon shows three words — **Published**, **Live**,
**Active** — for what a user experiences as two ideas. Should they become "Finalized"?

## What Carbon has today

| Surface | Label | Backing field |
|---|---|---|
| `WorkflowsTable.tsx:98` | `Published` / `Draft` badge | `workflow.activeVersionId != null` |
| `WorkflowVersionStatus.tsx:12` | `Live` badge on a version | version id == `activeVersionId` |
| `WorkflowActiveCheckbox.tsx` / `WorkflowActiveSwitch.tsx` | `Active` toggle | `workflow.active` boolean |
| `BuilderHeader.tsx:234` | `Publish` button | sets `activeVersionId` |

So **Published** and **Live** are the *same fact* seen from two levels (the workflow has a
chosen version / this version is the chosen one), and **Active** is a genuinely separate
on-off switch. The DB column is even named `activeVersionId`, which is why "active" leaked
into two unrelated meanings.

## Competitor scan

**n8n 2.0 (shipped Jan 2026) — the most direct precedent.** n8n *deleted* the
active/inactive toggle and replaced it with Publish / Unpublish. Autosave writes a new
saved version on every edit; only the **published** version responds to triggers. Two
words total: *saved* (draft) and *published*. They hit exactly Carbon's confusion and
resolved it by collapsing "active" into "published", not by inventing a third word.

**Retool Workflows.** Draft is the "current working version"; publishing creates a
numbered release. The Releases list tags the running one **Live**. Note the shape: `Live`
is a *marker on the published version*, not a separate state — the same relationship
Carbon's `Live` badge actually has. Retool has no separate active toggle.

**Zapier.** A Zap is a **draft** until you **Publish**; each publish makes a new version;
the previously published Zap stays running while you edit the draft. Zapier does keep a
separate **on/off** switch, but it is described as turning the Zap on or off — never
"active version".

**Salesforce Flow.** Version statuses are **Active**, **Draft**, **Obsolete**,
**InvalidDraft**. Activating a new version makes the previous one *Obsolete*. Salesforce
uses "Active" for the version and has no separate enable toggle, so there is no collision.

**Workato.** Versions are labelled **current**; the running/stopped concept is
**Start recipe / Stop recipe**. Again: one word per concept.

**HubSpot.** Draft vs published (version history), no on/off toggle; users have been
asking for the Zapier-style draft-over-live model.

## Findings

1. **Nobody ships the word "Finalized".** Zero of the six use it. It reads as an
   approval/document term (Carbon itself uses Finalized-ish language for quotes and
   documents), and it does not tell the user the version is *the one that runs*. Changing
   Published → Finalized would trade a term customers already know from Zapier/n8n/HubSpot
   for one they know from nowhere.
2. **The real bug is three labels for two concepts, not the choice of label.** Every tool
   surveyed keeps exactly one word per concept: one for "this is the definition that runs"
   (published / active / current) and, if it exists at all, one for "the whole thing is
   switched on".
3. **Two words dominate: Draft and Published.** Zapier, Retool, n8n and HubSpot all landed
   there independently. That is the safe, recognisable vocabulary.
4. **"Live" is a tag, not a state.** Retool proves the pattern is fine *as long as* it only
   ever decorates the published version in a version list — which is what Carbon's badge
   already does.

## Recommended direction (not yet implemented)

- Keep **Draft / Published** as the version vocabulary. Keep the **Publish** button.
- Either drop the `Live` badge in favour of `Published`, or keep `Live` *only* in the
  version-history list as Retool does — never alongside a second "Published" badge on the
  same screen.
- Rename the `Active` toggle so it stops competing: **Enabled / Paused** (or **On / Off**),
  or follow n8n and remove it entirely, making Unpublish the way to stop a workflow.
  Whichever is chosen, "active" should disappear from user-facing copy even though
  `activeVersionId` stays in the schema.

## Sources

- https://docs.n8n.io/build/understand-workflows/save-and-publish-workflows
- https://support.n8n.io/article/understanding-workflow-publishing-in-n-8-n-2-0
- https://docs.retool.com/workflows/guides/version-and-publish
- https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions
- https://zapier.com/blog/introducing-drafts/
- https://gearset.com/blog/flows-and-flow-definitions/
- https://docs.workato.com/recipes/version-management.html
- https://knowledge.hubspot.com/website-pages/restore-a-previous-version-of-content
