# Slack single source of truth — implementation plan (executed)

**Spec:** `.ai/specs/2026-09-01-slack-single-source-of-truth.md` · **Run log:** `.ai/runs/2026-09-01-slack-single-source-of-truth.md`
**Branch:** `feat/active-pieces-integration`

## Progress

- [x] Task 1: Allowlist types (`accountLabel.path`, `metadata`) + Slack row (16 scopes, metadata map)
- [x] Task 2: `connectionMetadataFrom` / `accountLabelFromBody` + tests
- [x] Task 3: `ExchangedTokens.body` + `readConnectionAccessToken` + tests
- [x] Task 4: Callback uses body-derived label + metadata
- [x] Task 5: Migration `20260901044047_slack-connections-single-source.sql` (hardened after review: user-validated `createdBy`, vault read before insert, `Expired` when tokenless, `Revoked` without secret, partial index, no webhook URL)
- [x] Task 6: Slack service — `getSlackWorkspace`, `getSlackWorkspaceByTeamId` (+ `AmbiguousSlackWorkspaceError`), `getSlackAuth` on connections
- [x] Task 7: Jobs — `send-slack.ts` (token resolved inside the single step), `slack-document-sync.ts` (four functions), `notify.ts` (added after review)
- [x] Task 8: Interactive route on `getSlackWorkspaceByTeamId`; `integrations.slack.install.ts` deleted; `integrations.slack.oauth.ts` kept as a 302 forwarder
- [x] Task 9: Slack card installs through the piece consent; installer/schemas removed; `@slack/oauth` dropped
- [x] Task 10: Notification-preferences page reads connections; dead settings helpers + `SECRET_KEYS.slack` removed
- [x] Task 11: Env — `SLACK_STATE_SECRET` removed; `SLACK_OAUTH_REDIRECT_URL` kept (no new var)
- [x] Task 12: Regenerate workflow catalog + Lingui; docs sync
- [x] Task 13: Verification + run log

## Notes

- `companyIntegration` has no `createdBy` and its `updatedBy` has no FK; `integrationConnection.createdBy` is NOT NULL → `user`. Hence the actor resolution chain in the migration.
- `getSlackWorkspace` = `readConnections(...).find(Active)` + `readConnectionAccessToken`; three round trips per call (accepted; see review MINOR 12).
