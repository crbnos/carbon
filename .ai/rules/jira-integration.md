---
paths:
  - packages/ee/src/jira/**
  - packages/jobs/src/inngest/functions/integrations/jira.ts
  - apps/erp/app/routes/api+/integrations.jira.*.ts
  - apps/erp/app/modules/quality/ui/Issue/Jira/**
---

# Jira Integration

Two-way sync between Carbon Quality action tasks (`nonConformanceActionTask`) and
Jira Cloud issues, via the Atlassian REST API v3 + OAuth 2.0 (3LO). Sibling of the
Linear integration (`linear-integration.md`); they share the
`externalIntegrationMapping` table and the Quality Issue UI.

## Package (`@carbon/ee/jira` + `@carbon/ee/jira.server`)

Code lives in `packages/ee/src/jira/`. Two export subpaths (see `packages/ee/package.json`):
- `@carbon/ee/jira` → `lib/index.ts` (richtext + types + utils; safe for client/shared code)
- `@carbon/ee/jira.server` → `lib/index.server.ts` (adds `client.ts` + `service.ts`; server-only)

- `config.tsx` — `Jira` integration descriptor via `defineIntegration` (id `"jira"`,
  category "Project Management", `active: !!JIRA_CLIENT_ID`). Registered in
  `packages/ee/src/index.ts` `integrations[]`. OAuth scopes: `read:jira-user`,
  `read:jira-work`, `write:jira-work`, `offline_access`. Also renders the
  `SetupInstructions` (webhook URL + which events to subscribe).
- `lib/client.ts` — `JiraClient` (singleton via `getJiraClient()`). REST calls go to
  `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3{path}`. `getAuthHeaders()`
  refreshes the access token when within a 5-min expiry buffer and persists the new
  credentials. Methods: `searchIssues`, `getIssue`, `createIssue`, `updateIssue`,
  `getTransitions`/`transitionIssue`, `createRemoteLink`/`getRemoteLinks`/`deleteRemoteLink`,
  `listProjects`, `getIssueTypes`, `listProjectUsers`, `findUserByEmail`, `healthcheck`.
  Also module-level OAuth helpers `exchangeCodeForTokens`, `refreshAccessToken`,
  `getAccessibleResources` (used to resolve `cloudId`).
- `lib/service.ts` — DB logic: `getJiraIntegration`, `updateJiraCredentials`,
  `linkActionToJiraIssue`, `unlinkActionFromJiraIssue`, `getJiraIssueFromExternalId`,
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

A linked task is a row: `entityType='nonConformanceActionTask'`, `integration='jira'`,
`externalId=<Jira issue id>`, `metadata=<JiraIssueMapping JSON>`, plus `companyId`.
No `externalId` column on the task table — query the mapping table (or the read in
`quality.service.ts`, which loads `jiraMappings` and exposes `task.jiraIssue`).

**RLS gotcha:** `externalIntegrationMapping` has only `SELECT` and `INSERT` policies
(migration `20260204001831_external-integration-mapping-rls.sql`) — **no UPDATE/DELETE**.
Any delete must use `getCarbonServiceRole()`. `linkActionToJiraIssue` and
`unlinkActionFromJiraIssue` both delete the old mapping via the service-role client for
this reason.

## Routes (`apps/erp/app/routes/api+/`)

- `integrations.jira.oauth.ts` — OAuth callback: exchanges code → tokens, calls
  `getAccessibleResources` for `cloudId`/`siteUrl` (uses the first resource),
  `upsertCompanyIntegration({ id:"jira", active:true, ... })`, then `config.onInstall`.
- `integrations.jira.issue.link.ts` — POST links an existing issue (syncs assignee by
  email→`user`, pushes the task's notes as the Jira description, creates a Carbon
  remote link); DELETE unlinks (Carbon DB first, then best-effort remote-link cleanup —
  finds the Carbon link by `application.name === "Carbon"` or
  `globalId.startsWith("carbon-")`, not by reconstructing the URL); GET searches issues.
- `integrations.jira.issue.create.ts` — POST creates a new issue (notes→ADF description)
  then links it; GET lists projects, and for a `projectKey` returns issue types +
  assignable users filtered to Carbon employees.
- `integrations.jira.issue.sync-notes.ts` — POST pushes Tiptap notes → ADF onto the
  linked issue's description (no-op if the task isn't linked).
- `webhook.jira.$companyId.ts` — inbound webhook. Validates the company's `jira`
  integration is active, parses with `syncIssueFromJiraSchema` (`@carbon/jobs`), then
  `trigger("sync-issue-from-jira", ...)`.

## Inbound webhook job (Inngest, NOT Trigger.dev)

`packages/jobs/src/inngest/functions/integrations/jira.ts` — `jiraSyncFunction`
(Inngest id `sync-issue-from-jira`, event `carbon/jira-sync`). Ignores everything but
`jira:issue_updated` / `issue_updated`. Looks up the action via the mapping table by
`externalId`, refetches the full issue, resolves assignee email→employee, and calls
`linkActionToJiraIssue(..., { syncNotes: true })` to update status/assignee/dueDate/notes.
Schema: `syncIssueFromJiraSchema` in `packages/jobs/src/schemas.ts`.

## Status mapping

Jira statusCategory → Carbon `nonConformanceTaskStatus`: `new`→Pending,
`indeterminate`→In Progress, `done`→Completed. Reverse maps Pending→`new`,
In Progress→`indeterminate`, Completed/Skipped→`done`. Jira changes status via
**transitions**, so `transitionIssue` finds a transition whose target category matches.

## UI (`apps/erp/app/modules/quality/ui/Issue/Jira/`)

`IssueDialog.tsx` (tabbed Link/Create — resets tab to "link" on close, closes after
unlink), `LinkIssue.tsx`, `CreateIssue.tsx`. Rendered from
`IssueTask.tsx` only when `integrations.has("jira")`; it reads `task.jiraIssue` to show
the linked badge and triggers note sync on save for linked action tasks. Only **action**
tasks can be linked.

## Notes

- `/search/jql` is the current search endpoint (`searchIssues`); the old `/search` was
  deprecated (410).
- Remote links use `globalId` = `carbon-<url>` and `application.name = "Carbon"`.
- Inbound sync is **Inngest**, consistent with the rest of the event system
  (`event-system.md`) — there is no `trigger/` dir for Jira.
