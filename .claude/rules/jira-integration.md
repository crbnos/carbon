---
paths:
  - packages/ee/src/jira/**
  - packages/jobs/src/inngest/functions/integrations/jira.ts
  - apps/erp/app/routes/api+/integrations.jira.*.ts
  - apps/erp/app/components/ActionTasks/Jira/**
---

# Jira Integration

The Jira Cloud client (Atlassian REST API v3 + OAuth 2.0 (3LO)), config and webhook.
Sibling of the Linear integration (`linear-integration.md`). The two-way sync of a
record and its issue (what syncs, the snapshot, the push, locks) is the shared engine
in `issue-sync.md`.

## Package (`@carbon/ee/jira` + `@carbon/ee/jira.server`)

Code lives in `packages/ee/src/jira/`. Two export subpaths (see `packages/ee/package.json`):
- `@carbon/ee/jira` → `lib/index.ts` (richtext + types + utils; safe for client/shared code)
- `@carbon/ee/jira.server` → `lib/index.server.ts` (adds `client.ts` + `service.ts`; server-only)

- `config.tsx` — `Jira` integration descriptor via `defineIntegration` (id `"jira"`,
  category "Project Management", `active: !!JIRA_CLIENT_ID`). Registered in
  `packages/ee/src/index.ts` `integrations[]`. OAuth scopes: `read:jira-user`,
  `read:jira-work`, `write:jira-work`, `offline_access`. Also renders the
  `SetupInstructions` (webhook URL + which events to subscribe + the "Secret" field).
  One setting: `webhookSigningSecret` (optional, `type: "secret"`, vaulted via
  `SECRET_KEYS.jira`; an empty field keeps the stored value). The drawer is only
  reachable after the OAuth install, so its Update button never installs Jira
  without credentials.
- `lib/client.ts` — `JiraClient` (singleton via `getJiraClient()`). REST calls go to
  `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3{path}`. `getAuthHeaders()`
  refreshes the access token when within a 5-min expiry buffer and persists the new
  credentials. Methods: `searchIssues`, `getIssue`, `createIssue`, `updateIssue`,
  `getTransitions`/`transitionIssue`, `createRemoteLink`/`getRemoteLinks`/`deleteRemoteLink`,
  `listProjects`, `getIssueTypes`, `listProjectUsers`, `findUserByEmail`,
  `listPriorities`, `healthcheck`. `updateIssue` (summary, description, assignee,
  priority, duedate) returns whether it succeeded.
  Also module-level OAuth helpers `exchangeCodeForTokens`, `refreshAccessToken`,
  `getAccessibleResources` (used to resolve `cloudId`).
- `lib/service.ts` — DB logic: `getJiraIntegration`, `updateJiraCredentials`,
  `unlinkActionFromJiraIssue`, `getJiraIssueFromExternalId`,
  `updateJiraIssueMapping`, `getCompanyEmployees`, `issueToMapping`.
- `lib/utils.ts` — status mapping (`mapJiraStatusToCarbonStatus` /
  `mapCarbonStatusToJiraCategory`).
- `lib/richtext.ts` — `adfToTiptap` / `tiptapToAdf` (Jira uses ADF; Carbon notes are
  Tiptap) + `TiptapDocument` type. Jira description ⇄ Carbon task `notes`.
- `lib/types.ts` — Zod schemas + types (`JiraIssue`, `JiraCredentials`, `JiraRemoteLink`, …).
- `hooks.server.ts` — `jiraHealthcheck` (delegates to `client.healthcheck`).

## Credentials

OAuth creds live in `companyIntegration.metadata.credentials`
(`{ accessToken, refreshToken, expiresAt, cloudId, siteUrl }`). `JIRA_CLIENT_ID` /
`JIRA_CLIENT_SECRET` come from `@carbon/auth` (env). Token refresh is handled inside
`getAuthHeaders` and rewritten via `updateJiraCredentials` using the service-role client.

## Storage of the link (`externalIntegrationMapping`)

A link is a row with `integration='jira'`, `externalId=<Jira issue id>` and
`metadata=<JiraIssueMapping JSON + the sync snapshot>` (`issue-sync.md`). No
`externalId` column on the task table.

**RLS gotcha:** `externalIntegrationMapping` has only `SELECT` and `INSERT` policies
(migration `20260204001831_external-integration-mapping-rls.sql`) — **no UPDATE/DELETE**.
Every write and delete uses `getCarbonServiceRole()` (`writeLinks`,
`unlinkActionFromJiraIssue`).

## Routes (`apps/erp/app/routes/api+/`)

- `integrations.jira.oauth.ts` — OAuth callback: exchanges code → tokens, calls
  `getAccessibleResources` for `cloudId`/`siteUrl` (uses the first resource),
  `upsertCompanyIntegration({ id:"jira", active:true, ... })`, then the server
  `onInstall` hook (converges the `jira-issue-sync` subscriptions), else `config.onInstall`.
- The POST/DELETE writes below are operations in `apps/erp/app/modules/shared/shared.server.ts`
  (`createJiraIssue` / `linkJiraIssue` / `unlinkJiraIssue`, called as
  `api.shared.linkJiraIssue(input)`), for an NCR action task, a change notice action task
  or a project element (`entityType`). Each is gated on the record's module
  (`syncedEntityPermissions`, `@carbon/ee/issue-sync`) and refused on a change notice
  whose workflow is locked or an element of a Closed project (`editableActionTask`).
- `integrations.jira.issue.link.ts` — POST links an existing issue (`linkExistingIssue`:
  pulls the issue's fields, pushes the task's notes as the description, then a Carbon
  remote link); DELETE unlinks (Carbon DB first, then best-effort remote-link cleanup —
  finds the Carbon link by `application.name === "Carbon"` or
  `globalId.startsWith("carbon-")`, not by reconstructing the URL); GET searches issues.
- `integrations.jira.issue.create.ts` — POST creates a new issue (notes→ADF description)
  then links it (`linkNewIssue`); GET lists projects, and for a `projectKey` returns issue types +
  assignable users filtered to Carbon employees.
- `webhook.jira.$companyId.ts` — inbound webhook. Reads the raw body once, validates
  the company's `jira` integration is active, verifies the signature (below), parses
  with `syncIssueFromJiraSchema` (`@carbon/jobs`), then
  `trigger("sync-issue-from-jira", ...)`.

## Webhook signing (opt-in)

The webhook is created BY HAND as a Jira admin webhook, so a signature cannot be
required without breaking existing installs. The route reads the secret with
`getWebhookSigningSecret(serviceRole, companyId, "jira", row)`
(`@carbon/ee/integrations/secrets`; a vault read failure → 500, fail-closed).

- Secret set → `verifyJiraWebhook` (`packages/ee/src/jira/lib/webhook.ts`, exported
  from `@carbon/ee/jira.server`): `X-Hub-Signature` must be `sha256=<hex HMAC-SHA256
  of the RAW body keyed by the secret>` (only the `sha256` method is accepted;
  constant-time, length-checked, non-hex rejected). Failure → logged `warning` with a
  `reason` + 401, before parsing or triggering. Scheme per
  https://developer.atlassian.com/cloud/jira/platform/webhooks/ ("Secure admin
  webhooks"). Jira sends no signed timestamp, so there is no replay window; the job
  re-fetches the issue, so a replay only re-applies Jira's current state.
- No secret → accepted as before, with one `warning` per delivery that it is unsigned.
- Shared HMAC compare: `verifyHmacSha256Signature`
  (`packages/ee/src/integrations/webhook-signature.ts`).
- Tests: `webhook.jira.$companyId.test.ts`.

## Inbound webhook job (Inngest, NOT Trigger.dev)

`packages/jobs/src/inngest/functions/integrations/jira.ts` — `jiraSyncFunction`
(Inngest id `sync-issue-from-jira`, event `carbon/jira-sync`). Handles
`jira:issue_updated` / `issue_updated` with `applyIssue` and `jira:issue_deleted` /
`issue_deleted` with `unlinkDeletedIssue`; ignores everything else. Schema:
`syncIssueFromJiraSchema` in `packages/jobs/src/schemas.ts`.

Assignee: an unassigned issue clears the Carbon assignee. An assignee with a hidden
email, or one who matches no employee, leaves it unchanged (`resolveInboundAssignee`).
`getCompanyEmployees` selects `user!inner(email)`. A task on a Done or Cancelled change
notice refuses inbound changes (`lockedFields`).

## Status mapping

Jira statusCategory → Carbon `nonConformanceTaskStatus`: `new`→Pending,
`indeterminate`→In Progress, `done`→Completed. Reverse maps Pending→`new`,
In Progress→`indeterminate`, Completed/Skipped→`done`. Jira changes status via
**transitions**, so `transitionIssue` finds a transition whose target category matches.

## UI (`apps/erp/app/components/ActionTasks/Jira/`)

`IssueDialog.tsx` (tabbed Link/Create — resets tab to "link" on close, closes after
unlink), `LinkIssue.tsx`, `CreateIssue.tsx`, shared by `IssueTask.tsx` and
`ChangeNoticeActions.tsx`, rendered only when `integrations.has("jira")`. The dialog
reads the record's `jiraIssue` (the link's `metadata`) and shows a refusal from
`metadata.sync.refused`.

## Notes

- `/search/jql` is the current search endpoint (`searchIssues`); the old `/search` was
  deprecated (410).
- Remote links use `globalId` = `carbon-<url>` and `application.name = "Carbon"`.
- Inbound sync is **Inngest**, consistent with the rest of the event system
  (`event-system.md`) — there is no `trigger/` dir for Jira.
