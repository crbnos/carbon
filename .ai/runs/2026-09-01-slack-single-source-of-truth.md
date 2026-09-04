# Run log — Slack single source of truth

Spec: `.ai/specs/2026-09-01-slack-single-source-of-truth.md` · Plan: `.ai/plans/2026-09-01-slack-single-source-of-truth.md`
Branch: `feat/active-pieces-integration` · Executed 2026-09-01 · Committed in `94cd181cd7` together with the piece (v1) and reconnect-prompt work.

## DB before / after (dev, company `HJzQ4BiYavLgTUi63ghSfJ`)

| | before | after |
|---|---|---|
| `companyIntegration.slack.metadata` | team_id `T0BFDGXDQMQ`, team_name `anshul`, channel `#new-channel`, channel_id `C0BFA82K8QM`, webhook url, bot_user_id | `{}` |
| `companyIntegration.slack.secretRef` | set | `NULL`; `get_integration_secret(...)` → null |
| `integrationConnection` (piece `slack`) | 0 rows | 1 row, Active, `accountLabel = anshul`, `metadata` = team/channel/bot/scopes (webhook keys stripped after review), `get_connection_secret ? 'accessToken'` = true |

Token verified against Slack afterwards: `auth.test` → team **anshul**, bot `message_mover`; `conversations.info` on the stored channel → `new-channel`. The hardened migration was re-run in a `BEGIN…ROLLBACK` transaction without error.

## Gates (final, after thermo-nuclear remediation)

typecheck `@carbon/ee @carbon/jobs @carbon/env @carbon/workflows erp` 5/5 · ee 582 ✓ · jobs 586 ✓ (`services.test.ts` env-gated on empty local `INNGEST_SIGNING_KEY`, pre-existing) · workflows 557 ✓ · `check:workflow-catalog` ok · biome clean on touched files · forwarder verified live (`302 → /api/integrations/connections/callback?code&state`).

## Browser criteria — UNVERIFIED, user-driven

Slack app needs the 16 bot scopes: `assistant:write chat:write.public commands files:read im:history incoming-webhook team:read chat:write users:read users:read.email channels:read groups:read chat:write.customize im:write channels:manage groups:write`. Redirect URL unchanged (legacy path forwards). Then: fresh consent → connection with `channel_id`, card Installed, builder shows the step form; slash command resolves the company by `team_id`.

## Follow-ups folded in the same day

- Review: `SLACK_CONNECTIONS_REDIRECT_URL` dropped; `SLACK_OAUTH_REDIRECT_URL` kept; `api+/integrations.slack.oauth.ts` forwards.
- Thermo-nuclear remediation (`.ai/runs/2026-09-01-thermo-nuclear-review.md`): `notify.ts` per-user DMs read the workspace (B1); migration hardened (M3); webhook URL never stored (M4); `send-slack` keeps the token out of step output (M6); ambiguous workspace refused (M8).
