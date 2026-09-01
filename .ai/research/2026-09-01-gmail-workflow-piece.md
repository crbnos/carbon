# Gmail as a workflow piece — research

> Date: 2026-09-01 · Author: Aashu · Feeds `.ai/specs/2026-09-01-gmail-workflow-piece.md`

## The package: `@activepieces/piece-gmail@0.13.0` (researched on 0.14.0; pinned 0.13.0 — see below)

- Self-contained bundle (no runtime deps; nodemailer + `@googleapis/gmail` inlined). `minimumSupportedRelease: 0.87.0`.
- `auth` is an ARRAY: `[OAuth2, CustomAuth("Service Account")]` — `getPieceOAuth2Auth` already picks the OAUTH2 member (Google Calendar has the same shape).
- Piece OAuth2 declaration: `authUrl https://accounts.google.com/o/oauth2/auth`, `tokenUrl https://oauth2.googleapis.com/token`,
  scope `gmail.send`, `gmail.readonly`, `gmail.compose`, `email`.
- Published actions (0.13.0): `send_email` (legacy), `gmail_send_email` (current), `request_approval_in_mail`,
  `reply_to_email`, `gmail_reply_to_thread`, `create_draft_reply`, `gmail_get_mail`, `gmail_get_message`,
  `gmail_search_mail`, `gmail_search_email`. Upstream `main` has ~25 more (drafts, forward, labels, threads) — not in 0.13.0.
- Every published action ships an `outputSchema` (coverage all-or-nothing per piece holds).
- Triggers exist (new email etc.) — out of scope, Carbon runs no piece triggers.

## Google scope classification (developers.google.com/workspace/gmail/api/auth/scopes)

| Scope | Class | Consequence |
|---|---|---|
| `gmail.send` | **Sensitive** | ordinary OAuth app verification (brand + privacy policy), which the Calendar app already needs |
| `email` (userinfo) | non-sensitive | already requested by Google Calendar's `accountLabel` |
| `gmail.readonly`, `gmail.compose`, `gmail.modify`, `gmail.metadata`, `mail.google.com` | **Restricted** | restricted-scope verification + an annual third-party **CASA security assessment** (paid, weeks) |

So the piece's default scope set is restricted-tier. A **send-only** override (`gmail.send` + `email`) stays sensitive-tier.

## What each action needs (read from the 0.13.0 bundle + upstream source)

- `gmail_send_email` / `send_email` (same props, same `run`): `users.messages.send` → `gmail.send`.
  - Blank `from` → `oauth2.userinfo.get()` → `email` scope. OK send-only.
  - `in_reply_to` set → `users.messages.list(q=Rfc822msgid:…)` → needs `gmail.readonly`. **Not OK send-only.**
  - `draft = true` → `users.drafts.create` → needs `gmail.compose`. **Not OK send-only.**
  - `attachments` is `ARRAY` of `{ data: base64|url, name }` objects. Carbon maps ARRAY → `list<string>`; strings would reach `run()` as malformed attachments. **Must be omitted.**
- `gmail_reply_to_thread`, `reply_to_email`, `create_draft_reply`: `message_id` DROPDOWN whose `options()` lists recent messages → `gmail.readonly`; `attachment` is `FILE` (unmappable).
- `gmail_get_message`, `gmail_get_mail`, `gmail_search_email`, `gmail_search_mail`: `gmail.readonly`.
- `request_approval_in_mail`: pauses the flow and waits on a callback URL (`ctx.run.pause`) — Carbon's shim throws on run control. Unusable.

## `gmail_send_email` vs legacy `send_email`

Identical props and `run`; only the `outputSchema` differs (`gmail_send_email` nests `data.{id,threadId,labelIds}` as children, `send_email` flattens via `value` paths). Both map through `outputs.ts`. Upstream keeps `send_email` for saved flows; `gmail_send_email` is the maintained one.

## Visibility outcome for `gmail_send_email` under the generic rules

Shown: `receiver` (list), `cc`, `bcc`, `subject`, `body`, `reply_to`, `sender_name`, `from`.
Auto-hidden with value (required + default): `body_type = plain_text`, `draft = false`.
Need allowlist overrides: `attachments` (omit), `in_reply_to` (omit, send-only), `draft` (omit + value false, so Advanced cannot flip it into a `gmail.compose` failure).

## Host facts that carry over unchanged

- Same Google OAuth app (`GOOGLE_OAUTH_*`) — already in `getBrowserEnv()`, so the card's "Coming soon" gate is free.
- A Gmail connection is its own `integrationConnection` row (`pieceName = "gmail"`), separate consent from Calendar, own refresh token. Google issues one refresh token per consent; consents for different scope sets on one client id do not interfere.
- `accountLabel` via `https://www.googleapis.com/oauth2/v2/userinfo` `email` — exactly Calendar's.
- Operational: the Gmail scope(s) must be added to the Google Cloud OAuth consent screen and go through sensitive-scope verification; until then only test users can consent.

## Why 0.13.0, not 0.14.0

pnpm-workspace.yaml sets `minimumReleaseAge: 4320` (3 days) and 0.14.0 was published 2026-09-01. 0.13.0 (2026-08-20) passes. Introspected 0.13.0: `gmail_send_email` props, `outputSchema` and the OAuth2 scope list are identical to 0.14.0. 0.13.0 actually ships MORE actions (26, incl. drafts/forward/labels/threads) than the trimmed 0.14.0 (10) — irrelevant under the allowlist, which exposes one.
