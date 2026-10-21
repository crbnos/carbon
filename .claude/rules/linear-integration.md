---
paths:
  - packages/ee/src/linear/**
  - packages/jobs/src/inngest/functions/integrations/linear.ts
  - apps/erp/app/routes/api+/integrations.linear.*.ts
---

# Linear Integration

The Linear client, config and webhook. EE package `@carbon/ee`, subpaths
`@carbon/ee/linear` (client) and `@carbon/ee/linear.server` (server). The two-way
sync of a record and its issue (what syncs, the snapshot, the push, locks) is the
shared engine in `issue-sync.md`.

## Pieces

- **Config:** `packages/ee/src/linear/config.tsx` — `defineIntegration` (id `"linear"`,
  category "Project Management", `active: true`). Settings: `apiKey` (required; zod
  must start with `lin_api`) and `webhookSigningSecret` (optional). Both are
  `type: "secret"` — vaulted via `SECRET_KEYS.linear` in
  `packages/ee/src/integrations/secrets.ts`, never in the plaintext `metadata`
  column; an empty field keeps the stored value. Renders setup instructions + webhook
  URL `/api/webhook/linear/{companyId}` + where Linear shows the signing secret.
- **Client:** `packages/ee/src/linear/lib/client.ts` — `LinearClient` over the Linear
  GraphQL API (`https://api.linear.app/graphql`, axios). Singleton `getLinearClient()`.
  Every method takes `companyId` first; auth header is the raw `apiKey` read from the
  company's `companyIntegration` row. Methods: `healthcheck`, `listTeams`, `listIssues`
  (search by term), `getIssueById`, `createIssue`, `updateIssue`, `getUsers` ({email|id}),
  `listTeamMembers`, `getWorkflowState`, `createAttachmentLink`, `listAttachments`,
  `removeAttachment`.
- **Client fixes to keep:** `getUsers` sends a `UserFilter` (`email: { eqIgnoreCase }`,
  `id: { eq }`) and returns `[]` with no filter; an unfiltered call returns every user.
  `getWorkflowState(companyId, teamId, type)` filters by team AND type and takes the
  lowest `position`: states belong to a team. Issue queries fetch `team { id }`.
  `LinearWorkStateType` includes `duplicate` (→ Skipped), or the schema refuses the issue.
- **Service:** `lib/service.ts` — `unlinkActionFromLinearIssue`,
  `getLinearIssueFromExternalId`, `getLinearIntegration`, `getCompanyEmployees`. The
  link write and the field updates live in the issue-sync engine.
- **Status map:** `lib/utils.ts` — enum `LinearWorkStateType` +
  `mapLinearStatusToCarbonStatus` / `mapCarbonStatusToLinearStatus`. `started`→"In
  Progress", `completed`→"Completed", `canceled`→"Skipped", else (triage/backlog/todo/
  unstarted)→"Pending".
- **Rich text:** `lib/richtext.ts` — `markdownToTiptap` / `tiptapToMarkdown`
  (+ `tiptapDocumentsEqual`, `isTiptapEmpty`). Linear description (markdown) ↔ Carbon
  task `notes` (Tiptap JSON).
- **Types:** `lib/types.ts` — `LinearIssueSchema` (zod): `id, title, description?, url,
  state{name,color,type}, identifier, dueDate?, priority?, assignee{email}?, team{id}?`.
  `updateIssue` returns `null` on failure; `removeIssueLink` removes one issue's back-link.

## The link lives in `externalIntegrationMapping`

One row per linked record, with the issue as `metadata` plus the sync snapshot. See
`issue-sync.md`.

## Inbound: Linear → Carbon (webhook → Inngest, NOT trigger.dev)

- Route `apps/erp/app/routes/api+/webhook.linear.$companyId.ts`: reads the raw body
  once, checks the integration exists + is active, verifies the signature (below),
  parses `syncIssueFromLinearSchema`, then `trigger("sync-issue-from-linear", payload)`.
- **Signing is OPT-IN.** Customers create the webhook by hand in Linear, so
  requiring a signature would break every install made before it existed. The route
  reads the secret with `getWebhookSigningSecret(serviceRole, companyId, "linear", row)`
  (`@carbon/ee/integrations/secrets`; throws when the vault is unreadable → the route
  returns 500, fail-closed, because "no secret" and "unreadable" are indistinguishable).
  - Secret set → `verifyLinearWebhook` (`packages/ee/src/linear/lib/webhook.ts`,
    exported from `@carbon/ee/linear.server`): `Linear-Signature` must be the hex
    HMAC-SHA256 of the RAW body keyed by the secret (constant-time, length-checked,
    non-hex rejected), AND the body's `webhookTimestamp` (UNIX ms) must be within
    `LINEAR_WEBHOOK_TOLERANCE_MS` (60 s) of now. Any failure → logged `warning` with a
    `reason` + 401, before parsing or triggering. Scheme per
    https://linear.app/developers/webhooks ("Securing webhooks").
  - No secret → accepted as before, with one `warning` per delivery that it is unsigned.
  - There is no "clear" for the secret (an empty secret field keeps the vaulted value).
  - The HMAC compare is shared: `verifyHmacSha256Signature`
    (`packages/ee/src/integrations/webhook-signature.ts`), also used by Jira and Ramp.
  - Tests: `webhook.linear.$companyId.test.ts` (stubs only the service-role client,
    the clock and `trigger`).
  - The settings action's "a credential is required" install check ignores
    `WEBHOOK_SIGNING_SECRET_KEY`, so a signing secret alone never satisfies it.
- Webhook body schema is **minimal**: `event.data = { id, assigneeId? }` only (type
  `"Issue"`, action `"update"` or `"remove"`) — `packages/jobs/src/schemas.ts`
  `syncIssueFromLinearSchema`. The full issue is re-fetched, never trusted from the payload.
- Trigger key `"sync-issue-from-linear"` → Inngest event `"carbon/linear-sync"`
  (`packages/lib/src/trigger.ts`). Handler is the **Inngest function**
  `packages/jobs/src/inngest/functions/integrations/linear.ts` (id `sync-issue-from-linear`):
  `remove` → `unlinkDeletedIssue`; `update` → `applyIssue` (issue-sync engine).

## Outbound: Carbon → Linear

- The POST/DELETE writes below are operations in `apps/erp/app/modules/shared/shared.server.ts`
  (`createLinearIssue` / `linkLinearIssue` / `unlinkLinearIssue`, `shared.server.ts`), gated on the task's module
  (`actionTaskPermissions`) and refused on a change notice whose workflow is locked.
- **Link existing** `api+/integrations.linear.issue.link.ts`: GET search issues; POST
  `linkExistingIssue` + a back-link attachment; DELETE unlink + best-effort remove the
  Linear attachment.
- **Create new** `api+/integrations.linear.issue.create.ts`: GET teams (+ team members
  filtered to matching Carbon employees when `?teamId`); POST create issue,
  `linkNewIssue`, attach.
- Field changes push through the `ISSUE_SYNC` subscription (`issue-sync.md`), not
  from routes.

## UI

`apps/erp/app/components/ActionTasks/Linear/{LinkIssue,CreateIssue,IssueDialog}.tsx`,
shared by quality tasks (`IssueTask.tsx`) and change notice tasks
(`ChangeNoticeActions.tsx`). The dialog reads the record's `linearIssue` (the link's
`metadata`, batch-read by `getIssueActionTasks` / `getChangeNoticeActions`) and shows a
refusal from `metadata.sync.refused`.

## Gotchas

- `getCompanyEmployees` must select `user!inner(email)`. Without `!inner`, PostgREST
  filters only the embed and returns every employee.
- An inbound assignee goes through `resolveInboundAssignee` (`packages/ee/src/issue-sync/assignee.ts`):
  an unassigned issue clears the Carbon assignee; an assignee who matches no employee
  leaves it unchanged.
- A `changeOrderActionTask` on a Done or Cancelled change notice refuses inbound
  changes (`lockedFields`, `isChangeNoticeLocked` from `@carbon/database/change-notice`).

- Webhook payload carries only `{id, assigneeId?}` — always re-fetch the issue.
- Assignee/employee matching is by **email** (Linear user ↔ Carbon employee).
- `companyIntegration` must exist and be `active` for the inbound webhook; the
  outbound push needs the `linear-issue-sync` subscription (`issue-sync.md`).
- API key is the raw `Authorization` header value (personal API key, `lin_api…`).
- Migration `packages/database/supabase/migrations/20251127091215_add_linear_integration.sql`
  seeds the `integration` row; the `externalIntegrationMapping` table comes from the
  `external-integration-mapping` migrations (see accounting-sync-handlers.md).
