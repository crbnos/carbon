---
paths:
  - packages/ee/src/slack/**
  - packages/ee/src/slack.server.ts
  - packages/ee/src/notifications/services/slack.ts
  - apps/erp/app/routes/api+/integrations.slack.*.ts
  - packages/jobs/src/inngest/functions/integrations/slack-document-sync.ts
  - packages/jobs/src/inngest/functions/notifications/send-slack.ts
  - packages/lib/src/slack.server.ts
---

# Slack Integration

One Slack card serves two consumers: the Carbon Assistant features (issue threads, the
Create Issue shortcut, notification DMs) and the Slack workflow steps. Slack is an
Activepieces **piece** card, so the install, the token and the accounts list are the
shared connection machinery in `workflow-integrations.md`. This rule covers what is
Slack-only. The AI chat itself is `chat-ai-sdk-info.md`.

## Overview

- `config.tsx` calls `definePieceIntegration("slack", …)`: id `slack`, category
  "Assistant", no settings, Install opens the consent popup.
- The gate is `active: CONTROLLED_ENVIRONMENT === false`. A controlled (ITAR) deployment
  sets `CONTROLLED_ENVIRONMENT`, so the card shows "Not Configured" and the connect route
  answers `unavailable` (`pieceConnectRefusal`, `settings.service.ts`).
- The gate does NOT read `SLACK_CLIENT_ID`. A server without the Slack app still shows
  Install. The connect route then answers `not-configured` (`resolveOAuthApp` throws).
- Slack is not in `INTEGRATION_WHITELIST` (`packages/ee/src/plan.ts`), so a company without
  the `INTEGRATIONS` feature gets `plan-required`.
- `companyIntegration.slack` is only the installed flag. The token and the workspace facts
  live on `integrationConnection` rows with `pieceName = 'slack'`.

## Key files

| File | Holds |
|---|---|
| `packages/ee/src/slack/config.tsx` | The card (`Slack`) |
| `packages/ee/src/slack/hooks.server.ts` | `slackOnConnect`: posts `postSlackWelcome` in the picked channel |
| `packages/ee/src/hooks.server.ts` | `pieceConnectHooks.slack` registers `slackOnConnect`; `pieceHooks` gives the uninstall hook |
| `packages/ee/src/slack/lib/client.ts` | `createSlackWebClient`, `postToSlackThread`, `createSlackThread`, `updateSlackMessage`, `postSlackWelcome` |
| `packages/ee/src/slack/lib/service.ts` | `getSlackWorkspace`, `getSlackWorkspaceByTeamId`, `getSlackAuth`, issue threads, `syncDocumentToSlack` |
| `packages/ee/src/slack/lib/messages.ts` | Block Kit formatters (`formatDocumentCreated`, `formatStatusUpdate`, `formatTaskUpdate`, `formatAssignmentUpdate`) |
| `packages/ee/src/slack.server.ts` | `@carbon/ee/slack.server`: re-exports client, messages and service |
| `packages/ee/src/notifications/services/slack.ts` | `SlackNotificationService` (issue events) |
| `apps/erp/app/routes/api+/integrations.slack.oauth.ts` | 302 forwarder to `/api/integrations/connections/callback` |
| `apps/erp/app/routes/api+/integrations.slack.interactive.ts` | Shortcut and modal handler |
| `packages/jobs/src/inngest/functions/integrations/slack-document-sync.ts` | Thread replies for issue updates |
| `packages/jobs/src/inngest/functions/notifications/send-slack.ts` | `send-slack`: one DM per event |
| `packages/lib/src/slack.server.ts` | `getSlackClient`, `postSuggestionToCarbonSlack` (Carbon's own workspace) |
| `packages/jobs/src/workflows/integrations/allowlist.ts` | The `slack` row: scopes, metadata paths, workflow actions |

## Data flow

### Install

1. The card's Install calls `startIntegrationConnect("/api/integrations/connections/slack/connect")`.
2. The connect route issues the cookie-bound state and builds the consent URL from the
   allowlist row (`authUrl` override, 16 bot scopes).
3. Slack redirects to `SLACK_OAUTH_REDIRECT_URL`. If that names `/api/integrations/slack/oauth`,
   the forwarder sends the query to the connections callback unchanged.
4. The callback calls `createConnection` with the metadata `connectionMetadataFrom` copies:
   `team_id`, `team_name`, `bot_user_id`, `channel`, `channel_id`, `scopes`.
5. The callback calls `markIntegrationInstalled`, then `onConnect` for a new account only.
   `slackOnConnect` posts the welcome in `metadata.channel_id`. A failure only logs a warning.

`channel_id` comes from the `incoming-webhook` scope's channel picker. The webhook URL is
never stored: it is a bearer capability, and settings admins can read `metadata`.

### Which workspace a company uses

- `getSlackWorkspace(serviceRole, companyId)` returns the OLDEST usable connection that has
  a `channel_id`, else the oldest usable one. Every outbound path calls it.
- `getSlackWorkspaceByTeamId(serviceRole, teamId)` routes an inbound request by `team_id`.
  It throws `AmbiguousSlackWorkspaceError` when two companies hold usable rows for one team.
- `getSlackAuth` wraps `getSlackWorkspace`. It returns `null` when the workspace has no
  `channel_id`, so the issue-thread features treat that workspace as not connected.
- Both readers get the token with `readConnectionAccessToken` (Slack bot tokens do not expire).

### Issue threads

1. `notifyIssueCreated` (`packages/ee/src/notifications/pipeline.ts`) sends to every active
   integration in `isNotificationService`, which lists `slack` only.
2. `SlackNotificationService` calls `createIssueSlackThread`. It posts the issue card in the
   workspace channel and inserts a `slackDocumentThread` row (`documentType: "nonConformance"`).
3. Status, task and assignment events call `syncIssue*ToSlack` → `syncDocumentToSlack`, which
   triggers `slack-document-created`, `-status-update`, `-task-update` or `-assignment-update`.
4. The Inngest functions in `slack-document-sync.ts` post the update in that thread.

### Create Issue shortcut

`integrations.slack.interactive.ts` verifies `x-slack-signature` (`v0`, HMAC-SHA256 of the
raw body with `SLACK_SIGNING_SECRET`, 5-minute window) before it reads the payload. It
picks the company with `getSlackWorkspaceByTeamId`. The `create_ncr_modal` shortcut opens
the Create Issue modal. Its `view_submission` calls `createIssueFromSlack`
(`apps/erp/app/modules/shared/shared.server.ts`, `permission: "system"`). That operation
maps the Slack user to an employee by email (`getCarbonEmployeeFromSlackId`). It inserts
the issue and posts its thread in the workspace channel, not the channel of the shortcut.

### Notification DMs

`notify.ts` (jobs) reads the token with `getSlackWorkspace`. It maps each recipient with
`getSlackUserIdByCarbonId` (`users.lookupByEmail`) and sends one `carbon/send-slack` per
match. `send-slack.ts` skips with `slack-integration-not-linked` when the company has no
workspace. `api+/account.notifications.ts` shows Slack as on only for a usable connection.

### Workflow steps

The allowlist row exposes `send_channel_message`, `send_direct_message`,
`slack-find-user-by-email` and `slack-create-channel`. A step picks its account through
`connectionId`, so it may use any connection, not only the one `getSlackWorkspace` picks.
See `workflow-integrations.md`.

### Carbon's own workspace

`getSlackClient()` with no token falls back to `SLACK_BOT_TOKEN`. `postSuggestionToCarbonSlack`
(`#feedback`) and the `onboard` job use it. This is Carbon's internal workspace, never a
customer's. `sendMessage` is a no-op when `getAppUrl()` contains `localhost`.

## Settings

| Env var | Read by |
|---|---|
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_OAUTH_REDIRECT_URL` | `resolveOAuthApp("slack")`; all three are required to connect |
| `SLACK_SIGNING_SECRET` | `integrations.slack.interactive.ts`; unset rejects every shortcut with 401 |
| `SLACK_BOT_TOKEN` | `getSlackClient()` fallback (Carbon's own workspace) |
| `CONTROLLED_ENVIRONMENT` | The card's `active` gate |

The card has no settings form (`settings: []`). The Accounts tab (`ConnectionsTab.tsx`)
lists the connected workspaces.

## Gotchas

- A workspace connected before the workflow scopes existed has 10 scopes. The Accounts row
  shows "Reconnect needed". The Assistant features keep working until the person reconnects.
- Two connections to different workspaces: the Assistant features use only the oldest one
  with a channel. Workflow steps can use either.
- No route handles Slack slash commands or Events API messages. The allowlist requests
  `commands`, `im:history` and `assistant:write`, but no code reads those events.
  `createSlackApp`, `verifySlackWebhook` and `getSlackThreadReplies` have no callers.
- The shortcut acts as the workspace's company with the service role. The Slack user's
  Carbon permissions are not checked. The valid signature is the only credential.
- `createConnection` refuses a workspace that another company already uses (`workspace-taken`).
  No unique index spans companies, so this check is not race-proof.
- `slack-document-sync.ts` builds links from `VERCEL_URL`, else `http://localhost:3000`.
- `SLACK_STATE_SECRET` is gone from `packages/env/src/schema.ts`. It is still listed in
  `packages/env/src/vercel-production.json`.

## Never

- Never store a Slack token or the incoming-webhook URL in `metadata` or `companyIntegration`.
- Never read the token outside `getSlackWorkspace` / `getSlackWorkspaceByTeamId` (or
  `readConnectionAccessToken` on a row you already read).
- Never pick a company for an inbound Slack request by anything other than a verified
  signature plus `team_id`.
- Never post to a customer channel with `SLACK_BOT_TOKEN`. `send-slack` returns a skip instead.

## Design history

- `.ai/specs/implemented/2026-09-01-slack-single-source-of-truth.md`
- `.ai/specs/implemented/2026-09-01-slack-workflow-piece.md`
- `.ai/plans/2026-09-01-slack-workflow-piece.md`, `.ai/research/2026-09-01-slack-workflow-piece.md`
