---
paths:
  - packages/ee/src/linear/**
  - packages/ee/src/notifications/services/linear.ts
  - packages/jobs/src/inngest/functions/integrations/linear.ts
  - apps/erp/app/routes/api+/integrations.linear.*.ts
---

# Linear Integration

Two-way sync between a Carbon **non-conformance action task**
(`nonConformanceActionTask`) and a **Linear issue**. EE package `@carbon/ee`,
subpaths `@carbon/ee/linear` (client) and `@carbon/ee/linear.server` (server). Only
action tasks can be linked — but `task.status.changed` also processes `investigation`
type, not just `action`.

## Pieces

- **Config:** `packages/ee/src/linear/config.tsx` — `defineIntegration` (id `"linear"`,
  category "Project Management", `active: true`). One setting `apiKey` (required; zod
  must start with `lin_api`). Renders setup instructions + webhook URL
  `/api/webhook/linear/{companyId}`.
- **Client:** `packages/ee/src/linear/lib/client.ts` — `LinearClient` over the Linear
  GraphQL API (`https://api.linear.app/graphql`, axios). Singleton `getLinearClient()`.
  Every method takes `companyId` first; auth header is the raw `apiKey` read from the
  company's `companyIntegration` row. Methods: `healthcheck`, `listTeams`, `listIssues`
  (search by term), `getIssueById`, `createIssue`, `updateIssue`, `getUsers` ({email|id}),
  `listTeamMembers`, `getWorkflowState`, `createAttachmentLink`, `listAttachments`,
  `removeAttachment`.
- **Service:** `lib/service.ts` — `linkActionToLinearIssue`, `unlinkActionFromLinearIssue`,
  `getLinearIssueFromExternalId`, `getLinearIntegration`, `getCompanyEmployees`.
- **Status map:** `lib/utils.ts` — enum `LinearWorkStateType` +
  `mapLinearStatusToCarbonStatus` / `mapCarbonStatusToLinearStatus`. `started`→"In
  Progress", `completed`→"Completed", `canceled`→"Skipped", else (triage/backlog/todo/
  unstarted)→"Pending".
- **Rich text:** `lib/richtext.ts` — `markdownToTiptap` / `tiptapToMarkdown`
  (+ `tiptapDocumentsEqual`, `isTiptapEmpty`). Linear description (markdown) ↔ Carbon
  task `notes` (Tiptap JSON).
- **Types:** `lib/types.ts` — `LinearIssueSchema` (zod): `id, title, description?, url,
  state{name,color,type}, identifier, dueDate?, assignee{email}?`.

## The link lives in `externalIntegrationMapping`

One row per linked task (the old `externalId` JSONB on the task is gone):
`entityType='nonConformanceActionTask'`, `entityId=<action task id>`,
`integration='linear'`, `externalId=<Linear issue id>`, `metadata=<full LinearIssue JSON>`,
`companyId`. `linkActionToLinearIssue` service-role-deletes any existing row, then inserts.
It **also** updates the task itself: `assignee`, mapped `status`, `dueDate`, and (when
`syncNotes`) markdown→Tiptap `notes`. `getLinearIssueFromExternalId(client, companyId,
actionId)` looks up by **`entityId`** (the action id, despite the name) and parses `metadata`.

## Inbound: Linear → Carbon (webhook → Inngest, NOT trigger.dev)

- Route `apps/erp/app/routes/api+/webhook.linear.$companyId.ts`: checks the integration
  exists + is active, parses `syncIssueFromLinearSchema`, then
  `trigger("sync-issue-from-linear", payload)`.
- Webhook body schema is **minimal**: `event.data = { id, assigneeId? }` only (type
  `"Issue"`, action `"update"`) — `packages/jobs/src/schemas.ts`
  `syncIssueFromLinearSchema`. The full issue is re-fetched, never trusted from the payload.
- Trigger key `"sync-issue-from-linear"` → Inngest event `"carbon/linear-sync"`
  (`packages/lib/src/trigger.ts`). Handler is the **Inngest function**
  `packages/jobs/src/inngest/functions/integrations/linear.ts` (id `sync-issue-from-linear`):
  find action via mapping by `externalId` → `getIssueById` → map assignee email→employee
  → `linkActionToLinearIssue(..., { syncNotes: true })`.

## Outbound: Carbon → Linear

- **Link existing** `api+/integrations.linear.issue.link.ts`: GET search issues; POST
  link `{actionId, issueId}` (map assignee email→user, link, create back-link attachment
  to `/x/issue/{nonConformanceId}/details`); DELETE unlink + best-effort remove the
  Linear attachment.
- **Create new** `api+/integrations.linear.issue.create.ts`: GET teams (+ team members
  filtered to matching Carbon employees when `?teamId`); POST create issue, link, attach.
- **Sync notes** `api+/integrations.linear.issue.sync-notes.ts`: POST `{actionId, notes}`
  → `tiptapToMarkdown` → `updateIssue({description})`.
- **Notification service** `packages/ee/src/notifications/services/linear.ts`
  (`LinearNotificationService`, id `"linear"`, registered in
  `packages/ee/src/notifications/index.ts`). Reacts to events (`notifications/types.ts`):
  `task.status.changed` (action|investigation → `getWorkflowState` + `updateIssue stateId`),
  `task.assigned` (nonConformanceActionTask → match email → `updateIssue assigneeId`),
  `task.notes.changed` (Tiptap → markdown → `updateIssue description`).

## UI

`apps/erp/app/modules/quality/ui/Issue/Linear/{LinkIssue,CreateIssue,IssueDialog}.tsx`.
The dialog reads `task.linearIssue`, hydrated in `quality.service.ts`
(`getIssueActionTasks` batch-reads `externalIntegrationMapping` `metadata` into a
`linearMappings` map). `IssueTask.tsx` renders the dialog only when the company has the
`linear` integration, and after notes edits POSTs to `path.to.api.linearSyncNotes`
(+ `linearCreateIssue`, `linearLinkExistingIssue`).

## Gotchas

- Webhook payload carries only `{id, assigneeId?}` — always re-fetch the issue.
- Assignee/employee matching is by **email** (Linear user ↔ Carbon employee).
- `companyIntegration` must exist and be `active` for both inbound webhook and outbound
  notifications.
- API key is the raw `Authorization` header value (personal API key, `lin_api…`).
- Migration `packages/database/supabase/migrations/20251127091215_add_linear_integration.sql`
  seeds the `integration` row; the `externalIntegrationMapping` table comes from the
  `external-integration-mapping` migrations (see accounting-sync-handlers.md).
