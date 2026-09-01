# Research: Slack as the second Activepieces workflow piece

Date: 2026-09-01. Companion to `.claude/rules/workflow-integrations.md` (the authoritative
"Adding a piece" checklist) and `.ai/research/activepieces-*.md`.

## 1. The piece — `@activepieces/piece-slack@0.17.9` (npm latest, inspected 2026-09-01)

Single minified bundle (`src/index.js`), no `lib/` sources shipped. Introspected by loading it
against `packages/jobs/node_modules` (framework resolves; same shape as `piece-google-calendar`).

**Auth** is an array `[slackOAuth2Auth, slackAuth]` — exactly like Google Calendar, so
`getPieceOAuth2Auth` picks the OAuth2 entry unchanged.

- OAuth2: `tokenUrl https://slack.com/api/oauth.v2.access`;
  `authUrl https://slack.com/oauth/v2/authorize?user_scope=<17 user scopes>` (the piece
  bakes a **user-token** request into the URL); `scope` = 30 bot scopes (channels:read,
  channels:manage, channels:history, chat:write, groups:*, im:*, mpim:*, users:read,
  users:read.email, files:read/write, reactions:*, usergroups:*, chat:write.customize,
  links:*, emoji:read, users.profile:read, channels:join, conversations.connect:write, …).
- CUSTOM_AUTH: `{ botToken*, userToken }` — unsupported by design (rule: OAuth2 only).

**Runtime auth contract** (from the bundle): `isCustomAuth = auth.type === "CUSTOM_AUTH"`;
bot token = `auth.access_token` otherwise; user token = `auth.data.authed_user.access_token`,
used ONLY when an action sends/reacts *as the user* (`sendAsBot=false`, `reactAsUser`).
`auth.data.team` is read by `getConnectionIdentifier` (auth-level, we never call it) and by
trigger `onEnable` (triggers are a non-goal). So our current
`buildPieceContext({ auth: { access_token } })` is sufficient for bot-only actions.

**Token response quirks**: `oauth.v2.access` returns HTTP 200 with `{ ok:false, error }` on
failure (our `readTokenResponse` then throws "returned no access token" — acceptable); bot
tokens carry **no `expires_in` and no refresh token** unless the app opts into token
rotation → `expiresAt = null` → `expiringSoon` is false → never refreshed. Account label:
`GET https://slack.com/api/auth.test` → `team` (workspace name).

**Actions**: ~70, with heavy duplication (legacy `send_channel_message` with a fetched
`channel: DROPDOWN` vs newer `slack_post_message` with `channel: SHORT_TEXT`). Only
`custom_api_call`, `delete-message`, `markdownToSlackFormat`, `slack-add-reaction-to-message`
and a handful of `slack_*` mutators lack `outputSchema`; every candidate below has one.

| action | props (types; `*` required; `=` default) | notes |
|---|---|---|
| `send_channel_message` — Send Message To A Channel | `info:MARKDOWN`, `channel:DROPDOWN*`, `text:LONG_TEXT`, `sendAsBot:CHECKBOX*=true`, `threadTs`, `username`, `profilePicture`, `iconEmoji`, `file:FILE`, `replyBroadcast=false`, `mentionOriginFlow=false`, `unfurlLinks=true`, `blocks:JSON=[]` | MARKDOWN/FILE/JSON are unmappable today |
| `send_direct_message` — Send Message To A User | `userId:DROPDOWN*`, `text:LONG_TEXT*`, `username`, `profilePicture`, `iconEmoji`, `mentionOriginFlow=false`, `blocks:JSON=[]`, `unfurlLinks=true` | |
| `slack-find-user-by-email` | `email:SHORT_TEXT*` | |
| `slack-create-channel` | `channelName:SHORT_TEXT*`, `isPrivate=false` | needs `channels:manage` |
| `retrieveThreadMessages` | `channel:DROPDOWN*`, `threadTs*` | read path |
| `updateMessage` | `info:MARKDOWN`, `channel:DROPDOWN*`, `ts*`, `text*`, `mentionOriginFlow`, `blocks:JSON` | |

`mentionOriginFlow=true` calls the host `flows`/`run` context (our stubs throw) → must stay
hidden/pinned false. `DROPDOWN` channel/user lists run the piece's own `options()` through the
existing `integration.property` provider (`conversations.list` → `channels:read`/`groups:read`;
`users.list` → `users:read`).

## 2. Gaps in the current host for this piece

1. **`toValueType` runs before `visibilityOf`** (`integrations/catalog.ts`), so an unmappable
   prop (`MARKDOWN`, `FILE`, `JSON`) fails the generator even when the allowlist hides it.
   Activepieces `MARKDOWN` is display-only (never collects a value); `FILE`/`JSON` here are
   optional extras.
2. **Consent URL** (`integrations.connections.$piece.connect.ts`) is `new URL(auth.authUrl)` +
   our params, so Slack's baked-in `user_scope=` survives and every connecting user would hand
   Carbon a personal user token we do not use; and `scope` is the piece's full 30-scope list.
   The Slack app manifest must declare every requested scope or Slack answers `invalid_scope`.
3. `access_type=offline&prompt=consent` are Google params; Slack ignores unknown query params.

## 3. The existing Slack integration (Carbon Assistant) — collision

`packages/ee/src/slack/config.tsx` already registers `id: "slack"` (name "Slack", category
"Assistant"): a bot install via `@slack/oauth` (`integrations.slack.install.ts` →
`integrations.slack.oauth.ts`), scopes `assistant:write chat:write.public chat:write commands
files:read im:history incoming-webhook team:read users:read users:read.email`, token in the
vault under `companyIntegration.secretRef` (`SECRET_KEYS.slack`), metadata `team_id`,
`team_name`, `channel`, webhook `url`, `bot_user_id`. Drives issue/NCR thread sync, notification
fan-out (`carbon/send-slack`), slash-command interactivity. Env: `SLACK_CLIENT_ID`,
`SLACK_CLIENT_SECRET`, `SLACK_OAUTH_REDIRECT_URL`, `SLACK_SIGNING_SECRET`, `SLACK_STATE_SECRET`,
`SLACK_BOT_TOKEN` (Carbon's own workspace).

The workflow design leans on `card id === piece name === PIECE_ALLOWLIST key`
(`integrations.$id.tsx` grafts the Accounts tab from `PIECE_ALLOWLIST[id]`, the callback upserts
`companyIntegration[id]`, `hooks.server.ts` is keyed by id, the builder links to
`path.to.integration(piece)`). A `"slack"` allowlist key would therefore bolt workflow accounts
onto the Assistant card and have the piece callback mark the Assistant "Installed" without its
metadata. The two installs also request different scope sets against (potentially) the same
Slack app.

Full maps from the two exploration passes: see `../scratch` notes in this session; the
rule file remains the source of truth for the mechanics.
