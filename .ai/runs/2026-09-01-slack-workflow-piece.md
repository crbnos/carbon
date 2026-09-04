# Run log — Slack as a workflow integration piece (v1)

Plan: `.ai/plans/2026-09-01-slack-workflow-piece.md`
Spec: `.ai/specs/2026-09-01-slack-workflow-piece.md`
Branch: `feat/active-pieces-integration` · Executed 2026-09-01 · **Nothing committed** (user commits).
Recreated after the file was removed from disk outside the session. The card/credential model of this
run was superseded the same day by `2026-09-01-slack-single-source-of-truth.md`.

## What landed

| Task | Result |
|---|---|
| 1. Piece dep | `@activepieces/piece-slack@0.17.9` exact pin in `packages/jobs/package.json`; bundle loads, 72 actions. |
| 2. Allowlist | `AllowlistPropOverride.omit`, `AllowlistEntry.oauth.{authUrl,scope}`; `slack` row (4 actions: `send_channel_message`, `send_direct_message`, `slack-find-user-by-email`, `slack-create-channel`). 4 registry tests; the pre-existing "unknown piece" fixture renamed `slack` → `notion`. |
| 3. Visibility | `Visibility` gains `omit`; `MARKDOWN` auto-omits; allowlist `omit` honoured. 4 tests. |
| 4. Generator | `catalog.ts` consults visibility BEFORE `toValueType`; `toPropsValue` skips `MARKDOWN`. Added during execution: `vendorText` straightens backticks / `${` in vendor labels and descriptions (Slack's `threadTs` help text tripped `assertLabelIsSafe`). New `catalog.test.ts`. |
| 5. Consent URL | `buildConsentUrl` in `oauth.ts`; connect route calls it. 3 tests. |
| 6. Mark installed | `markIntegrationInstalled` in `settings.server.ts` (insert-if-absent / re-activate, never touches metadata); callback uses it. |
| 7. Assistant guard + token error | `getSlackAuth` null-guard (later rewritten in v2); `readTokenResponse` names Slack's in-body `error`. 1 test. |
| 8. Card | `hooks.server.ts` `slack` entry (health + uninstall revoke); card copy updated. |
| 9. Env | `SLACK_CONNECTIONS_REDIRECT_URL` added (later removed in v2's review — `SLACK_OAUTH_REDIRECT_URL` kept instead). |
| 10. Builder | Connect link → `${path.to.integration(piece)}?tab=connections`. |
| 11. Regen | Catalog: 6 integration steps, exactly 4 `integration.slack.*`; none of `info/file/blocks/sendAsBot/mentionOriginFlow` in `send_channel_message`; Lingui extracted. |
| 12. Docs | `workflow-integrations.md` synced; spec status → implemented. |

## Automated gates (at the time)

typecheck 5/5 · jobs 574 ✓ (`services.test.ts` env-gated, pre-existing) · ee 575 ✓ · workflows 557 ✓ · catalog check ok · biome clean.

## Deviations

`vendorText` added mid-run (recorded in the plan first); no per-task commits (user's rule).
