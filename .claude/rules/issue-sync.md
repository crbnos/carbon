---
paths:
  - packages/ee/src/issue-sync/**
  - packages/jobs/src/inngest/functions/events/issue-sync.ts
  - packages/jobs/src/inngest/functions/integrations/linear.ts
  - packages/jobs/src/inngest/functions/integrations/jira.ts
  - apps/erp/app/routes/api+/integrations.linear.*.ts
  - apps/erp/app/routes/api+/integrations.jira.*.ts
  - apps/erp/app/components/ActionTasks/Linear/**
  - apps/erp/app/components/ActionTasks/Jira/**
---

# Issue sync (Linear and Jira)

Two-way sync between a Carbon **synced record** and one Linear or Jira **issue**.
Spec: `.ai/specs/2026-10-17-issue-tracker-sync.md`. The tracker clients and their
webhooks are in `linear-integration.md` and `jira-integration.md`; this rule is the
engine both trackers share.

## Synced records

`syncedEntities` (`packages/ee/src/issue-sync/entities.ts`, `@carbon/ee/issue-sync`)
names each table that can link to an issue, and the columns the sync reads:

| Table | Parent | Text column | Fields | Permission |
|---|---|---|---|---|
| `nonConformanceActionTask` | `nonConformanceId` | `notes` | status, assignee, dueDate, description | `update: quality` |
| `changeOrderActionTask` | `changeOrderId` | `notes` | status, assignee, dueDate, description | `update: parts` |
| `projectElement` (every type) | `projectId` | `description` | title (`name`), description, status (state group), assignee (`ownerId`), priority, dueDate (`targetDate`) | `update: projects` |

It replaced `@carbon/ee/action-task-entity` (`actionTaskEntities`); the routes and
`getActionTaskWithParent` (`shared.server.ts`) read it. `detailPath(parentId, id)`
is the Carbon back-link on the issue.

## The link and its sync snapshot

A link is one `externalIntegrationMapping` row: `entityType`, `entityId`,
`integration` (`linear` / `jira`), `externalId` (the issue id), `metadata`.
`metadata` is the issue as the dialogs show it (`LinearIssue` / `JiraIssueMapping`)
plus a `sync` key (`LinkSyncSchema`, `types.ts`):

- `sync.values[field] = { carbon, remote }` — what the last sync agreed on. `carbon`
  is `carbonValues(row)`, `remote` is `linearValues` / `jiraValues` of the issue
  (`canonical.ts`). A description is an FNV-1a hash (`hashText`), not the text.
- `sync.refused = { at, fields, reason }` — the last inbound change a lock refused.

The two values are the **echo guard**. Outbound pushes a field only when the row
differs from `carbon` (`changedOutbound`); inbound applies a field only when the issue
differs from `remote` (`changedInbound`). Each side writes both values after it acts,
so the event its own write raises finds nothing to do. Pinned by `echo.test.ts`.
`hashText` sorts object keys first (a JSONB column returns them re-ordered), and a
rich text with no text in it is `null` on both sides.

A **first sync** — a new link, or a link with no `sync` (made before the engine) —
has nothing to compare with. Outbound it pushes only what Carbon has
(`firstSyncOutbound`); inbound it takes the issue's values but no empty one, and never
over a description Carbon has (`firstSyncInbound`). An empty value never overwrites a
real one.

`writeLinks` upserts on `(entityType, entityId, integration, companyId)` with the
service role (the table has no UPDATE policy). Never delete-and-reinsert a link: that
drops the snapshot.

## Outbound: an event subscription, not route calls

1. Every write to a synced table raises an `ISSUE_SYNC` event
   (`ensureIssueSyncSubscriptions`, subscription `${tracker}-issue-sync`, UPDATE and
   DELETE). The Linear and Jira install, settings-save and uninstall hooks
   (`hooks.server.ts`) converge it; the link routes and the inbound jobs converge it
   too, so an old install heals on first use.
2. The queue sends `carbon/event-issue-sync`. `issueSyncFunction`
   (`jobs/.../events/issue-sync.ts`) fans the batch out per company.
3. `issueSyncPushFunction` (`carbon/issue-sync.push`) runs `pushRecords` for UPDATEs
   and `deleteLinks` for DELETEs.
4. `pushRecords` skips links of a tracker that is not active, reads the CURRENT
   rows (the event is a hint), pushes the changed
   fields (`trackers/linear.server.ts`, `trackers/jira.server.ts`), reads the issue
   back, and stores what the tracker really holds as `remote`.

So any writer reaches the tracker: routes, MCP, the API, workflows, server functions
and the supplier portal. `dispatch_event_batch` skips `ISSUE_SYNC` while
`app.sync_in_progress` is set, so a dataset apply or a restore pushes nothing.

The push and the inbound jobs share `ISSUE_SYNC_CONCURRENCY`
(`"issue-sync-" + companyId`, `scope: "env"`): a push and a pull of one company never
interleave.

There is no route-level Linear or Jira push any more: `LinearNotificationService`,
`JiraNotificationService`, `notifyTaskNotesChanged` and the `sync-notes` routes are
gone. `notifyTaskStatusChanged` / `notifyTaskAssigned` remain for Slack only.

## Inbound

The webhook jobs call `applyIssue(client, { companyId, tracker, issueId })`
(`engine.server.ts`):

1. Read the link by `(integration, externalId, companyId)` and the issue from the
   tracker.
2. `changedInbound` picks the fields that moved.
3. `lockedFields(type, ctx)` (`locks.ts`) removes the fields a lock protects: every
   field of a task on a Done or Cancelled change notice; every field of an element on
   a Closed project; an element's title and description while the plan is locked
   (`isProjectPlanLocked`, `@carbon/database/project-plan` — they are plan-layer
   fields). Progress fields of a locked plan still sync.
4. Write the allowed fields; store the snapshot and the refusal.

An assignee goes through `resolveInboundAssignee`: an unassigned issue clears the
Carbon assignee; an assignee who matches no employee (or whose Jira email is hidden)
leaves it unchanged. Carbon never pushes back over a refused tracker edit; the dialog
shows "Not applied: <reason>" and a warning icon on its trigger.

A deleted issue (Linear `remove`, Jira `issue_deleted`) deletes the link
(`unlinkDeletedIssue`) and keeps the Carbon record. A deleted Carbon record deletes
its links (`deleteLinks`) and removes the back-link, best-effort; it never deletes an
issue.

## Linking

- **Link existing** → `linkExistingIssue`: pull first (`applyIssue` with `initial`),
  except a description the record already has. The route then sends
  `carbon/issue-sync.push` (trigger `issue-sync-push`), which pushes that description.
- **Create new** → `linkNewIssue` writes the link; the route sends
  `carbon/issue-sync.push` with `initial: true`.
- The routes never push inline: the push runs under the per-company key, so the
  webhook it raises cannot overtake the snapshot it writes.
- Both refuse an issue already linked to another record: the inbound job finds a
  link by the issue id, so one issue drives one record.

## Project elements

- An element's `status` value is its state's **group**
  (`carbonValues(..., { stateGroupById })`); the tracker knows no company-specific
  state. Outbound: `groupToLinearType` → the team's first state of that type, or
  `groupToJiraCategory` → a transition. Inbound: `linearTypeToGroup` /
  `jiraCategoryToGroup` (`new` keeps Backlog, `done` keeps Cancelled), then
  `pickStateForGroup` keeps the element's own state when it is in the group, else the
  group's default; `completedAtForGroup` sets `completedAt` as
  `updateProjectElementField` does. Both helpers are in `@carbon/database/project-plan`.
- Priority: `priorityToLinear` / `linearToPriority` (0 None … 4 Low);
  `priorityToJira` / `jiraToPriority` by name (Lowest → Low), and the push sends a
  Jira name only when `listPriorities` has it.
- Jira: a status push to the category the issue is already in sends no transition
  (Backlog → Unstarted, Completed → Cancelled). When Jira refuses a combined update (a
  field not on the edit screen), the push retries each field alone.
- The element page header renders the Linear and Jira dialogs (`ElementView.tsx`);
  the route loader reads the element's links. `projectElementLinkRefusal`
  (`shared.server.ts`) refuses a link on a Closed project.
- Start date, labels, milestone and the parent link do not sync.

