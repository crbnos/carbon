# Slack as a workflow integration piece

> **Superseded in part (2026-09-01):** the card/credential model and every mention of
> `SLACK_CONNECTIONS_REDIRECT_URL` below were replaced by `2026-09-01-slack-single-source-of-truth.md`
> — `SLACK_OAUTH_REDIRECT_URL` keeps its name and `api+/integrations.slack.oauth.ts` forwards to the
> connections callback. The allowlist/`omit`/generator changes stand.

> Status: implemented (2026-09-01)
> Author: Aashu
> Date: 2026-09-01

## TLDR

Add `@activepieces/piece-slack` as the second row of `PIECE_ALLOWLIST`, so a workflow can
**send a message to a channel, send a message to a user, find a user by email, and create a
channel** as `integration` nodes. The piece lives **on the existing Slack (Assistant) card**
under id `slack`, connects through the **same Slack app** with a **bot-only, narrowed scope
set**, and stores per-account connections in `integrationConnection` exactly like Google
Calendar. Three small generic host changes fall out of it (an `omit` prop override, allowlist
`oauth.authUrl`/`scope` overrides, and a "mark installed" that never clobbers an existing
row). No migration. Research: `.ai/research/2026-09-01-slack-workflow-piece.md`. Rule:
`.claude/rules/workflow-integrations.md` (the "Adding a piece" checklist is followed here,
with the deviations called out).

## Problem Statement

Workflows can call exactly one vendor (Google Calendar). Slack is the obvious second: it is
where shop-floor and office notifications already land, and Carbon already owns a Slack app
(the Carbon Assistant), so the one real gate for a new piece — a registered, reviewable OAuth
app — is already passed. But the Assistant already holds the card id `slack`, and the whole
workflow-integration design keys the card, the allowlist, the hooks, the connections table
and the builder's "Connect" link on `card id === piece name`. The piece cannot be dropped in
by the checklist alone; the two have to share one card without sharing code paths.

## Goals

1. Four Slack steps in the builder's Integration node, with fetched channel/user dropdowns,
   typed outputs, and the ordinary connection picker.
2. One Slack card in Settings → Integrations: Install = Assistant (unchanged), Accounts tab =
   workflow connections (add / rename / disconnect), health reflects both.
3. Consent asks for the **bot scopes the four steps need, and nothing else** — no user token.
4. Every host change is generic (data on the allowlist or a rule that applies to all pieces);
   no `if (pieceName === "slack")` anywhere.
5. The Assistant keeps working unchanged whether or not workflow accounts exist.

## Non-Goals

- Slack triggers (webhook lifecycle) — unchanged v1 non-goal.
- Send-as-user / react-as-user paths (they need `auth.data.authed_user`, a user token, and
  user scopes). Deliberately unreachable.
- More than the four actions. Adding one later is an allowlist edit plus a scope check.
- Making the Assistant install create a workflow connection (one consent for both). Two
  consents, two token rows; Slack keeps scopes additive per app+workspace so this is safe.
- A separate "Slack (Workflows)" card, or renaming the Assistant's id.
- Storing the vendor's full token response (`auth.data`) — not needed for bot-only actions.

## Proposed Solution

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Card identity | Allowlist key **`slack`** = existing card id | User decision (Q1). One Slack card; the Accounts tab, hooks, health and builder link all key off the id with no new mapping. Cost: the card now means two things — mitigated below. |
| OAuth app | Same `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`; new `SLACK_CONNECTIONS_REDIRECT_URL` | Slack scopes are additive per app+workspace and earlier tokens stay valid (docs.slack.dev/authentication/installing-with-oauth), so one app serves both installs. The redirect differs because the piece callback is `/api/integrations/connections/callback`, not the Assistant's route. |
| Scopes | Bot-only, narrowed, via new allowlist `oauth.scope` + `oauth.authUrl` overrides | User decision (Q2). The piece's `authUrl` bakes in 17 user scopes and asks 30 bot scopes; we request the 10 the four actions and their dropdowns use. Data on the row, not a branch. |
| Actions | `send_channel_message`, `send_direct_message`, `slack-find-user-by-email`, `slack-create-channel` | User decision (Q3). These are the `DROPDOWN`-bearing variants (fetched channel/user lists); all four ship an `outputSchema`. |
| Unusable props | New `AllowlistPropOverride.omit` (+ optional `value`) | `hidden` demotes to Advanced, where an author could still flip `sendAsBot` off or enable `mentionOriginFlow` and hit a host capability we refuse. `omit` removes the prop from both maps; a pin still applies at run time. Required + omit without value fails the generator. |
| `MARKDOWN` props | Auto-omitted by the generator | Activepieces `Property.MarkDown` is display-only and never collects a value; it is not an input. |
| Unmappable optional props (`FILE`, `JSON`) | Still fail the generator unless explicitly `omit`ted | Keeps "refuse, never degrade": a human decides per prop; nothing is dropped silently. |
| Mark-installed in the callback | Insert-if-absent / re-activate; **never overwrite metadata** | Today's `upsertCompanyIntegration(metadata: {})` would wipe the Assistant's `team_id`, `channel_id`, webhook url. Generic and idempotent; Google Calendar is unaffected. |
| Assistant row without a bot token | `getSlackAuth` returns `null` when the merged metadata has no `access_token` | A row can now be "installed" by a workflow connection alone. The Assistant must treat that as not connected, not crash on `undefined`. |
| Health / Uninstall | `hooks.server.ts` `slack` entry: `pieceConnectionsHealthy` + `revokeConnectionsForPiece` | Same one-liner as Google Calendar. Uninstall disconnects the Assistant **and** revokes workflow accounts — one card, one Uninstall. |
| Builder "Connect" link | `path.to.integration(piece)` + `?tab=connections` for every piece | On the merged card the big Install button installs the Assistant; the builder must land the author on Accounts → Add account. Harmless for Google Calendar. |
| Card gating | Unchanged (`CONTROLLED_ENVIRONMENT === false`) | The Assistant already needs `SLACK_CLIENT_ID`; an unconfigured server returns the existing `not-configured` error from the connect route. No browser env change (checklist step 4 is N/A). |
| Token refresh | None — `expiresAt` null | Slack bot tokens do not expire without token rotation; `expiringSoon(null)` is already false. |
| Slack's `200 { ok:false, error }` | `readTokenResponse` names `body.error` in the thrown message | Slack rejects with HTTP 200. The message reaches server logs only; the browser still gets an error code. |
| Account label | `GET https://slack.com/api/auth.test` → `team` | Workspace name tells two connections apart; existing best-effort `accountLabelFor`. |

### 1. Allowlist row

`packages/jobs/src/workflows/integrations/allowlist.ts`:

```ts
slack: {
  package: "@activepieces/piece-slack",
  version: "0.17.9",                       // exact; assertPinnedVersions gates it
  label: "Slack",
  actions: [
    "send_channel_message",
    "send_direct_message",
    "slack-find-user-by-email",
    "slack-create-channel"
  ],
  oauth: {
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    redirectUrlEnv: "SLACK_CONNECTIONS_REDIRECT_URL",
    authUrl: "https://slack.com/oauth/v2/authorize",   // drops the piece's user_scope
    scope: [
      "channels:read", "groups:read",                  // channel dropdown (conversations.list)
      "chat:write", "chat:write.public",               // post; public channels the bot has not joined
      "chat:write.customize",                          // username / icon props
      "im:write",                                      // DM (conversations.open)
      "users:read", "users:read.email",                // user dropdown, lookupByEmail
      "channels:manage", "groups:write"                // create public / private channel
    ]
  },
  accountLabel: { url: "https://slack.com/api/auth.test", field: "team" },
  props: {
    send_channel_message: {
      sendAsBot: { omit: true, value: true },
      mentionOriginFlow: { omit: true },
      file: { omit: true },
      blocks: { omit: true }
    },
    send_direct_message: {
      mentionOriginFlow: { omit: true },
      blocks: { omit: true }
    }
  }
}
```

`AllowlistEntry.oauth` gains optional `authUrl?: string` and `scope?: readonly string[]`.
`AllowlistPropOverride` gains `omit?: boolean`.

### 2. Generator (`integrations/catalog.ts`, `visibility.ts`, `properties.ts`)

- `visibilityOf` returns a third shape `{ show: false, omit: true, value? }` when the override
  says `omit`, or when `property.type === "MARKDOWN"`.
- The prop loop consults visibility **first**; an omitted prop is skipped before `toValueType`
  runs, so an unmappable type is only ever an error for a prop that would be rendered.
- `assertHiddenPropIsSatisfied` already fails a required prop with no value; it applies to
  omitted props too (`sendAsBot` is required, hence `value: true`).
- `pinnedValues` returns omitted-with-value pins exactly as it returns hidden ones, so
  `toPropsValue` sends `sendAsBot: true` at run time and never stores it on a node.
- `toPropsValue` never sends a `MARKDOWN` prop (there is no input to read).

### 3. Consent URL (`integrations.connections.$piece.connect.ts`)

`new URL(entry.oauth.authUrl ?? auth.authUrl)` and `scope = (entry.oauth.scope ?? auth.scope).join(" ")`.
The Google-specific `access_type` / `prompt` params stay; Slack ignores them.

### 4. Callback (`integrations.connections.callback.ts`)

Replace the unconditional `upsertCompanyIntegration(..., metadata: {})` with a
`markIntegrationInstalled(client, { id, companyId, updatedBy })` in `settings.server.ts`:
read the row; if absent insert `{ active: true, metadata: {} }`; if present and inactive set
`active: true` only; if present and active do nothing. Metadata and `secretRef` are never
touched. Cache invalidation as today.

### 5. Assistant hardening (`packages/ee/src/slack/lib/service.ts`)

`getSlackAuth` returns `null` when `metadata.access_token` is not a non-empty string.
`send-slack.ts` already falls back to the env token when no per-company token resolves —
verified in the plan, not changed.

### 6. Settings card (`packages/ee/src/slack/config.tsx`, `hooks.server.ts`)

- Copy: `shortDescription` / `description` mention both uses ("Use the Carbon Assistant in
  Slack, and let workflows post to your channels."). `defineIntegration` copy is plain
  strings on every card today (Google Calendar included) and is rendered untranslated, so this
  edit follows that convention; making card copy Lingui-aware is a cross-card change outside
  this spec.
- `hooks.server.ts` gains the `slack` entry (health + uninstall one-liners).
- The Accounts tab, Add account, rename and Disconnect come for free from
  `PIECE_ALLOWLIST["slack"]` in `integrations.$id.tsx`.

### 7. Builder

No vendor code. `IntegrationNodeForm`'s Connect link gains `?tab=connections`. The generated
catalog emits `integration.slack.<action>` for the four steps, label "Slack", inputs per §1/§2,
outputs from each action's `outputSchema` (+ `count`, `result`).

### 8. Environment

- `packages/env/src/index.ts`: `SLACK_CONNECTIONS_REDIRECT_URL` (server-only, beside
  `SLACK_OAUTH_REDIRECT_URL`).
- `.env.example`, `sst.config.ts`, `ci/src/deploy.ts`: wired the same way `SLACK_OAUTH_REDIRECT_URL` is.
- Slack app manifest (manual, the real gate): add the redirect URL and the 10 bot scopes.

## Data Model Changes

None. `integrationConnection.pieceName = 'slack'` rows reuse the existing table, RLS and
vault RPCs. `companyIntegration.slack` keeps its current jsonschema.

## API / Service Changes

- `PIECE_ALLOWLIST`: new row; `AllowlistEntry.oauth.{authUrl,scope}`, `AllowlistPropOverride.omit`.
- `visibilityOf` / `pinnedValues` / catalog prop loop: omit semantics, MARKDOWN auto-omit.
- Connect route: allowlist overrides win over the piece's `authUrl` / `scope`.
- `settings.server.ts`: `markIntegrationInstalled` (new); callback uses it.
- `connections.ts` `readTokenResponse`: includes `body.error` in the message when present.
- `getSlackAuth`: null-guard.
- `hooks.server.ts`: `slack` entry.

## UI Changes

- Slack card copy; Accounts tab appears on it.
- Builder: Integration node lists "Slack" with four steps; Connect link deep-links to Accounts.
- New builder/catalog copy is Lingui-translatable (the generator emits `msg` strings). Card
  copy stays a plain string per the existing `defineIntegration` convention (see §6).

## Acceptance Criteria

1. `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog` pass with the
   Slack row; `actions.generated.ts` contains exactly four `integration.slack.*` steps.
2. `integration.slack.send_channel_message` has visible inputs `connectionId`, `channel`
   (options provider `integration.property`), `text`, `threadTs`, `username`, `profilePicture`,
   `iconEmoji`, `replyBroadcast`, `unfurlLinks` (optional-with-default props stay visible under
   the existing rules); no Advanced inputs; **no** `info`, `file`, `blocks`, `sendAsBot`,
   `mentionOriginFlow` in either map. `send_direct_message` likewise has no
   `blocks` / `mentionOriginFlow`.
3. A generator run on a fixture piece with an optional `JSON` prop and no `omit` override
   still fails with `UnmappablePropertyError`; with `omit: true` it passes; a required prop
   with `omit: true` and no `value` fails with the "hidden with no value" error.
4. `toPropsValue` for `send_channel_message` with inputs `{ channel, text }` yields
   `sendAsBot: true` and no `info` / `mentionOriginFlow` / `blocks` / `file` keys.
5. `GET /api/integrations/connections/slack/connect` returns a URL on
   `https://slack.com/oauth/v2/authorize` whose `scope` is the 10 scopes above and which has
   **no** `user_scope` parameter; `client_id` is `SLACK_CLIENT_ID`; `redirect_uri` is
   `SLACK_CONNECTIONS_REDIRECT_URL`.
6. Callback on a company whose `companyIntegration.slack` row already holds Assistant
   metadata: after connecting, the row's `metadata` and `secretRef` are byte-identical to
   before and `active` is true. On a company with no row: a row with `metadata: {}` exists.
7. `getSlackAuth` returns `null` (no throw) for an active `slack` row whose vault/metadata has
   no `access_token`.
8. Settings → Integrations → Slack shows the Accounts tab; Add account opens the Slack consent
   popup; a connected account lists with the workspace name as its label; Disconnect sets it
   Revoked; Uninstall revokes remaining accounts and deactivates the Assistant.
9. In the builder, with no Slack account the Integration node shows "Connect Slack" linking to
   `/x/settings/integrations/slack?tab=connections`; with one account the connection field is
   hidden and its id stored on the node; the channel dropdown lists public and private channels.
10. A published workflow with a `send_channel_message` step posts to the chosen public channel
    without the bot being invited; the run's outputs expose the projected message fields and
    `result`.
11. Google Calendar's generated catalog is unchanged except for the Connect link query string.

## Risks

- **One card, two meanings.** "Installed" now lights up when only a workflow account exists;
  the Assistant's own features do nothing until its Install runs. Mitigated by the copy and the
  `getSlackAuth` guard; accepted by the user in Q1.
- **Uninstall is shared.** Removing the Assistant also revokes workflow accounts (and vice
  versa there is no partial uninstall). Documented in the deactivate flash copy if it proves
  confusing.
- **Manifest drift.** A scope requested but not declared in the Slack app manifest fails at
  consent with `invalid_scope`. The 10 scopes are listed in one place (the allowlist row) so
  the manifest can be diffed against it.
- **Private channels** still require inviting the bot; `chat:write.public` covers public
  channels only. The piece surfaces Slack's `not_in_channel` as the step error.
- **Same bot, more scopes.** Connecting a workflow account adds scopes to the Assistant's
  existing bot token (Slack additive scopes). Harmless, but visible to a workspace admin.

## Open Questions

- [x] Card identity: separate card vs merge into `slack` vs bridge to the Assistant token —
  **Answer:** merge into the existing `slack` card (user, 2026-09-01). Consequences: never
  overwrite the row's metadata; guard `getSlackAuth`; deep-link the builder to Accounts.
- [x] Scopes: piece defaults (30 bot + 17 user) vs bot-only narrowed vs widen the Assistant
  install — **Answer:** bot-only, narrowed to the 10 the four actions need, via allowlist
  `oauth.authUrl` / `oauth.scope` overrides (user, 2026-09-01).
- [x] Action set — **Answer:** core four: send to channel, send to user, find user by email,
  create channel (user, 2026-09-01).

## Changelog

- 2026-09-01 — Draft written after the three questions above were resolved.
- 2026-09-01 — Implemented; run log at `.ai/runs/2026-09-01-slack-workflow-piece.md`.
- 2026-09-01 — Card/credential model superseded by `2026-09-01-slack-single-source-of-truth.md` (the Assistant now consumes the Slack connection; no second store).
