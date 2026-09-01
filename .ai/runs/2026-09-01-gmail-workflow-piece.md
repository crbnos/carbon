# Run log — Gmail as a workflow integration piece

**Plan:** `.ai/plans/2026-09-01-gmail-workflow-piece.md` · **Spec:** `.ai/specs/2026-09-01-gmail-workflow-piece.md`
**Branch:** `feat/active-pieces-integration` · **Date:** 2026-09-01

## Deviations from plan

- **Pin 0.13.0, not 0.14.0.** `pnpm-workspace.yaml` `minimumReleaseAge: 4320` (3 days) refused
  0.14.0 (published 2026-09-01). User chose 0.13.0 (2026-08-20); its `gmail_send_email` props,
  `outputSchema` and OAuth scopes are identical. Spec/plan/research updated.
- **`events.generated.ts` reverted.** The generator re-emitted a 3-line key reorder
  (`productionQuantity` / `scheduleOutdatedAt`) unrelated to Gmail; reverted to HEAD and
  `check:workflow-catalog` still passes.
- **No per-task commits** — user rule (never auto-commit). Tree left for the user to commit.
- `packages/jobs/AGENTS.md` untouched: it does not enumerate allowlisted pieces.
- **Browser test 1 (criterion 3) FAILED, then fixed.** Consent succeeded with exactly `gmail.send` +
  `email`, but the callback logged `Integration connection save failed: name=object detail=` and
  redirected with `save-failed`. Cause: `markIntegrationInstalled` inserts `companyIntegration`,
  whose `id` is an FK to `integration.id`, and no `gmail` row existed (Calendar's was added by its
  migration; the rule's checklist did not mention it). Fix: the `gmail` row is inserted beside
  `google-calendar`'s in `20260901173000_workflow-integration-connections.sql` (first written as a
  separate migration, then folded in and both branch migrations re-stamped past main's newest, since
  the feature is not in production yet; local `schema_migrations` rows re-pointed by hand),
  applied locally with `pnpm db:migrate`; the callback now logs a PostgREST error's JSON instead of
  an empty string; the rule's "Adding a piece" checklist gained the step. The stale `integrationConnection`
  row from the failed attempt is revived by `createConnection` on retry (lookup by name, any status).
- **Browser test 2 (criteria 3–4) connected, then showed "Reconnect needed" immediately.** Stored
  `metadata.scopes` = `openid …/gmail.send …/userinfo.email`; required = `…/gmail.send email`.
  Google canonicalises the `email` alias. Fix: both Google rows spell scopes as full URLs (Calendar
  gained an `oauth.scope` override with the same three permissions); `oauth.test.ts` now refuses
  `email`/`profile`/`openid` on any row. The existing Gmail row needs no change — its granted set
  already contains both canonical scopes. Findings from all three pieces written as the numbered
  WHAT BIT US block above `PIECE_ALLOWLIST`, pointed to from the rule and `.ai/lessons.md`.
- **Browser test 3 (criterion 5, builder) — two form defects.** (a) `receiver`/`cc`/`bcc`/`reply_to`
  are `list<string>` and `fields/control.ts` sent EVERY list to the variable picker, so an address
  could not be typed. Fix: `isWritableList` — a list of plain text renders as a `CreatableMultiSelect`
  chip field whose value is stored as a literal list (`LiteralControl`); a plain comma-separated box was
  tried and rejected — chips make "several recipients" visible; `{` still binds a whole list.
  Calendar's `attendees` gets the same. New `control.test.ts` (5 cases). (b) `body` is a vendor
  `ShortText` → one-line box. Fix: `LONG_TEXT` → `template: true` in `properties.ts` (Slack message,
  Calendar description now multiline), plus an allowlist `template` prop override for Gmail's body.
  Catalog regenerated (4 integration inputs carry `template: true`); jobs 97 integration tests,
  workflows 558, erp typecheck all green.

## Automated gates

| Gate | Command | Result |
|---|---|---|
| Package pinned | `grep piece-gmail packages/jobs/package.json` → `"0.13.0"`; piece loads, 26 actions | PASS |
| jobs typecheck | `pnpm --filter @carbon/jobs typecheck` | PASS |
| ee typecheck | `pnpm --filter @carbon/ee typecheck` | PASS |
| erp typecheck | `pnpm --filter erp typecheck` (after catalog regen) | PASS |
| workflows typecheck | `pnpm --filter @carbon/workflows typecheck` | PASS |
| jobs tests | `pnpm --filter @carbon/jobs test` — 45 files / 677 tests with `.env.local` sourced | PASS (7 new: registry ×4, oauth ×2, visibility ×1, catalog ×1 … see below) |
| ↳ note | `src/workflows/actions/services.test.ts` fails to IMPORT without the server env (`INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `SUPABASE_SERVICE_ROLE_KEY` via `@carbon/auth`) — pre-existing on this branch, unrelated to Gmail; passes once `.env.local` is sourced | env-only |
| ee tests | `pnpm --filter @carbon/ee test` — 59 files / 810 tests | PASS |
| workflows tests | `pnpm --filter @carbon/workflows test` — 31 files / 558 tests | PASS |
| catalog | `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog` — 7 integration steps; exactly `integration.gmail.gmail_send_email` emitted | PASS |
| lingui | `pnpm run lingui:extract && pnpm run lingui:clean` — 13 `.po` files, 0 `#:` origin lines; new msgids incl. "Gmail", "Gmail: Send Email", "Receiver Email (To)" | PASS |
| biome | `pnpm exec biome check` on the allowlist, 4 test files, `gmail/config.tsx`, `index.ts`, `hooks.server.ts` | PASS |

New tests (8): registry `gmail` ×4, oauth `buildConsentUrl` gmail ×1 + `requiredScopesFor` gmail ×1,
visibility `pinnedValues` gmail ×1, catalog `buildPieceActionDeclarations (gmail)` ×1.

## Acceptance criteria

| # | Criterion | Status | How |
|---|---|---|---|
| 1 | Catalog emits the one step with inputs `connectionId, receiver, cc, bcc, subject, body, reply_to, sender_name, from`; advancedInputs `body_type` only | PASS | `catalog.test.ts` + inspection of `actions.generated.ts` (attachments / in_reply_to / draft: 0 occurrences) |
| 2 | Card "Coming soon" without `GOOGLE_OAUTH_CLIENT_ID`, Install with it | BROWSER-PENDING | Settings → Integrations → Gmail card; toggle the env var |
| 3 | Consent screen lists only "Send email on your behalf" + email; Accounts tab shows the address; card Installed | BROWSER-PENDING | Install → popup → consent → Accounts tab. Needs the Google Cloud steps below first |
| 4 | `metadata.scopes` holds `gmail.send`; vault holds the token; `metadata` never holds a token | PASS (invariant) | `oauth.test.ts` metadata mapping + `connections.test.ts` vault invariant; the scope string itself is BROWSER-PENDING (inspect the row after consent) |
| 5 | Send Email node with a variable body delivers from the connected address; outputs carry `messageId`/`threadId` | BROWSER-PENDING | Builder → Integration → Gmail → Send Email → Test run → check Sent folder + run history outputs |
| 6 | Advanced → Body Type `html` works; `draft`/`attachments`/`in_reply_to` offered nowhere | PASS (form shape) / BROWSER-PENDING (html send) | `catalog.test.ts`; HTML delivery needs a real send |
| 7 | Disconnect → reconnect banner in the node form; step fails before vendor call with reconnect copy | BROWSER-PENDING | Accounts → Disconnect → reopen node → Test run |
| 8 | Uninstall revokes every `gmail` connection and leaves Calendar's untouched | PASS | `hooks.server.ts` `gmail` entry → `revokeConnectionsForPiece(…, "gmail", …)` filters by `pieceName` (ee `connections.test.ts` covers the reader) |
| 9 | Second Google account connects under another name and is independently pickable | BROWSER-PENDING | Accounts → Add account (different Google login) → node connection dropdown |
| 10 | Scoped tests + typechecks pass | PASS | table above |

## Operator to-do (Google Cloud console, before criteria 2–9 can be exercised)

1. OAuth consent screen → Scopes → add `https://www.googleapis.com/auth/gmail.send` (sensitive tier; `email` is already there for Calendar's account label).
2. Add the tester's Google account under Test users (needed until verification is approved).
3. Submit sensitive-scope verification: brand info, privacy policy URL, and a short demo video of the Carbon consent + send flow. Calendar's scopes ride the same submission.
4. No env change: `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URL` are reused as-is.

## Files touched

Modified: `packages/jobs/package.json`, `pnpm-lock.yaml`, `packages/jobs/src/workflows/integrations/{allowlist,registry.test,oauth.test,visibility.test,catalog.test}.ts`,
`packages/ee/src/{index.ts,hooks.server.ts}`, `packages/workflows/src/catalog/{actions,labels}.generated.ts`,
`packages/locale/locales/*/erp.po` (13), `.claude/rules/workflow-integrations.md`, `packages/ee/AGENTS.md`, `.env.example`.
Created: `packages/ee/src/gmail/config.tsx`, `.ai/specs/2026-09-01-gmail-workflow-piece.md`, `.ai/plans/2026-09-01-gmail-workflow-piece.md`, `.ai/research/2026-09-01-gmail-workflow-piece.md`, this file.
