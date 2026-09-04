# Slack: one source of truth — the Carbon Assistant becomes a consumer of a Slack connection

> Status: implemented (2026-09-01)
> Author: Aashu
> Date: 2026-09-01
> Supersedes: the "one card, two meanings" trade-off in `2026-09-01-slack-workflow-piece.md` (v1)

## TLDR

v1 put the Slack workflow piece on the existing Assistant card, which left **two stores of truth**:
the card and the Assistant read `companyIntegration.slack` (token in the integration vault,
`team_id`/`channel_id`/webhook in its metadata), while the workflow builder and step runner read
`integrationConnection` rows for piece `slack`. They diverged the moment one was set without the
other ("Installed · Healthy" on the card, "Connect Slack" in the builder). This spec makes
**`integrationConnection` the only place Slack credentials and workspace facts live**, exactly as
Google Calendar already works: `companyIntegration.slack` shrinks to the installed flag with
`metadata: {}`, Install becomes the piece consent (union of scopes, one popup), and every Assistant
reader (`getSlackAuth`, interactive slash commands, notifications incl. per-user DMs, issue thread
sync) resolves the company's **oldest Active** Slack connection. A one-time migration backfills
existing installs. Readers that had silently degraded since the Aug-17 vault scrub (`send-slack.ts`,
`interactive.ts`, `notify.ts` reading `metadata.access_token`) are fixed by construction.
Research: `.ai/research/2026-09-01-slack-workflow-piece.md` §3. Rule: `.claude/rules/workflow-integrations.md`.

## Goals

1. One consent installs Slack for both the Assistant and workflows; card, health, builder and Assistant all read the same rows.
2. `companyIntegration.slack` carries no token and no workspace facts (like `google-calendar`).
3. Existing installs keep working without re-consent (backfilled), including slash commands and issue thread sync.
4. No `if (pieceName === "slack")` in shared code; what Slack needs from the token response is data on the allowlist row.
5. Delete the Assistant's private OAuth flow (`integrations.slack.install.ts`, the `@slack/oauth` installer, `SLACK_STATE_SECRET`); keep the legacy redirect path as a forwarder so deployed environments need no env or Slack-app change.

## Non-Goals

Per-workspace Assistant settings; outbound multi-workspace routing beyond "oldest Active"; changing the Assistant's messages or the workflow actions; Slack triggers; non-OAuth auth.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Credential home | `integrationConnection` (piece `slack`) only | Already the model for Google Calendar; vault RPCs, refresh claim, Accounts UI, health and builder gating all exist. |
| `companyIntegration.slack` | Installed flag, `metadata: {}`, jsonschema `{properties:{}}`; `SECRET_KEYS.slack` removed | Identical to `google-calendar`. The `nonconformance_*` schema fields were read nowhere — dropped. |
| Install | The piece consent via `startIntegrationConnect`, like Google Calendar | One popup, one callback, one state signer (`SESSION_SECRET`). |
| OAuth app | Same `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_OAUTH_REDIRECT_URL`; legacy `/api/integrations/slack/oauth` becomes a 302 forwarder onto the connections callback | Keeping the old env name and forwarding the old path means a deployed environment needs no env or Slack-app redirect change (user, 2026-09-01). |
| Scopes | Allowlist `oauth.scope` = 16 (Assistant's 10 + workflow's 6) | Slack scopes are additive per app+workspace; one bot serves both. `incoming-webhook` keeps Slack's channel picker, which is how the Assistant learns its channel. |
| Workspace facts | Allowlist `metadata: Record<connectionKey, tokenResponsePath>` + `accountLabel: { path }` | `connectionMetadataFrom(entry, body)` copies exactly the declared scalar paths: `team_id`, `team_name`, `bot_user_id`, `channel`, `channel_id`, `scopes`. **Not** the incoming-webhook URL — a bearer capability, and `metadata` is readable by every settings admin (review finding M4). |
| Outbound connection | Oldest Active connection for piece `slack` | User decision. Deterministic, no new column. |
| Inbound connection | Active row whose `metadata->>'team_id'` matches the event; **refused** (ephemeral message) when the workspace is linked to more than one company | One Slack app serves every tenant, so ambiguity is possible; acting in the wrong company is worse than refusing (review finding M8). |
| Token outside a workflow step | `readConnectionAccessToken` — Active + non-expiring only | Slack tokens do not expire; a refreshable vendor must use `resolveConnectionAuth`. |
| Backfill | One migration, idempotent; vault read BEFORE insert; no token → `Expired` + `lastError`; inactive → `Revoked` with no secret; `createdBy` = a user id that still exists (row's `updatedBy` → first member → skip with NOTICE) | Review findings M3: never an Active row without a secret, never a 23503 from a stale user id. |
| Backfilled scopes | `metadata.scopes` records the 10 Assistant scopes; not re-consented automatically | Surfaced by `2026-09-01-connection-reconnect-prompts.md`. |
| Uninstall | `revokeConnectionsForPiece` (unchanged) | One path. |

## Acceptance Criteria (all met, see run log)

Metadata pick returns the declared keys only; migration leaves one Active connection with a vault secret and a stripped card row, and is a no-op on re-run; `readConnectionAccessToken` refuses non-Active/expiring; `getSlackWorkspace` = oldest Active; consent `scope` = 16 unique, no `user_scope`; forwarder 302s `?code&state` to the callback; `install.ts` and `SLACK_STATE_SECRET` gone; `send-slack`, `notify`, `slack-document-sync`, `interactive` all resolve the per-company token through `getSlackWorkspace`; package tests and typechecks pass.

## Open Questions

- [x] One store or two? — one; `integrationConnection` (user).
- [x] Which connection when several exist? — oldest Active outbound (user); inbound by `team_id`, ambiguous → refuse.
- [x] How does the callback learn `team_id`/channel without Slack-specific code? — allowlist path map + `accountLabel.path`.
- [x] New redirect env var or keep the old one? — keep `SLACK_OAUTH_REDIRECT_URL`; legacy route forwards (user).

## Changelog

- 2026-09-01 — Draft after the divergence surfaced in dev; implemented the same day.
- 2026-09-01 — Revised after review: no new env var; forwarder kept.
- 2026-09-01 — Thermo-nuclear remediation folded in (M3 migration hardening, M4 no webhook URL in metadata, M8 ambiguity refusal, B1 `notify.ts`).
