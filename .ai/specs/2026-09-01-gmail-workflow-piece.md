# Gmail as a workflow integration piece

> Status: implemented (2026-09-01)
> Author: Aashu
> Date: 2026-09-01
> Research: `.ai/research/2026-09-01-gmail-workflow-piece.md`
> Rule: `.claude/rules/workflow-integrations.md` ("Adding a piece" checklist)
> Precedent: `.ai/specs/2026-09-01-slack-workflow-piece.md`, Google Calendar (`packages/ee/src/google-calendar/config.tsx`)

## TLDR

Add `@activepieces/piece-gmail@0.13.0` as the third row of `PIECE_ALLOWLIST`, exposing ONE
step — **Gmail: Send Email** — as an `integration` node. It ships as its own **Gmail** card
(id `gmail`), connects through the **same Google OAuth app** as Google Calendar
(`GOOGLE_OAUTH_*`), and requests a **send-only** scope set (`gmail.send` + `email`) instead of
the piece's default, which would drag the app into Google's restricted-scope tier and an annual
CASA security assessment. No schema change, no new env vars, no generic host change: this is an
allowlist row, a card, one hook line, tests and a regenerated catalog.

## Problem Statement

A workflow can post to Slack and write to a calendar, but cannot send an email — the most
common way a shop talks to a supplier or customer ("PO issued", "quote ready", "shipment
late"). Carbon's own transactional email is system-branded and unconfigurable per company;
the ask is to send from the company's *own* Gmail/Workspace account, with the message landing
in that mailbox's Sent folder and replies coming back to a real person.

Everything needed to do that already exists in the branch (connections, consent, refresh,
the Integration node). What is missing is the piece.

## Goals

- A workflow author can add an Integration node → Gmail → Send Email, pick a connected Google
  account, and send a plain-text or HTML email with To/CC/BCC, subject, body, an optional
  display name and Reply-To — with workflow variables in every text field.
- Settings → Integrations shows a **Gmail** card with the same Install → consent popup →
  Accounts tab flow as Google Calendar; "Coming soon" when the Google app is unconfigured.
- Only `gmail.send` and `email` are ever requested. A connection's granted scopes are recorded
  so the existing "Reconnect needed" machinery works unchanged if the set grows later.
- The step's outputs (`messageId`, `threadId`, `labels`, `status`) are typed and referenceable
  by later steps, as every piece step's are.

## Non-Goals

- Reading, searching, replying to or drafting emails (needs `gmail.readonly` / `gmail.compose`,
  both restricted-tier). If ever wanted, that is a scope-tier decision with a compliance cost,
  not a code change.
- Attachments, including Carbon-generated PDFs (quote, PO, invoice). Deferred: the workflow
  engine has no file value type. Follow-up spec.
- Threading a message into an existing conversation (`in_reply_to`): the piece resolves it
  through `messages.list`, which needs `gmail.readonly`.
- Gmail triggers ("new email received"): Carbon runs no piece triggers.
- The piece's Service Account auth variant: `getPieceOAuth2Auth` already selects the OAuth2
  member and ignores it.
- A shared "Google" card covering Calendar + Gmail with one consent. One card per piece is the
  rule (`id` === piece name) and the two scope sets are verified separately by Google anyway.
- Replacing Carbon's system email (`packages/ee/src/email`, Resend/SMTP). That card stays as is.

## Proposed Solution

### Design Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Scope set | `oauth.scope` override: `["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"]` (canonical spelling — Google reports `email` as `userinfo.email`, see changelog) | Piece default adds `gmail.readonly` + `gmail.compose` (restricted tier → CASA). Send-only stays sensitive tier — same verification the Calendar app already needs. **User decision.** |
| 2 | Action set | `["gmail_send_email"]` | The only action `gmail.send` covers. `send_email` is the legacy twin (same props, same `run`); `gmail_send_email` is the maintained one with the structured `outputSchema`. |
| 3 | `attachments` prop | `omit: true` | `ARRAY` of `{data,name}` file objects; Carbon would send `list<string>`, which `run()` would try to attach. Deferred by **user decision**. |
| 4 | `in_reply_to` prop | `omit: true` | Setting it calls `messages.list` → `gmail.readonly` → 403 at run time under send-only. Hiding it (Advanced) would leave a trap; omitting removes it. |
| 5 | `draft` prop | `omit: true, value: false` | Required-with-default would auto-hide it into Advanced, where flipping it calls `drafts.create` → `gmail.compose` → 403. Pin it off and out of the form. |
| 6 | `body_type` prop | leave to the generic rule (hidden, value `plain_text`, reachable under Advanced) | Required with a default; HTML is a legitimate Advanced choice and needs no extra scope. |
| 7 | `cc`, `bcc`, `reply_to`, `sender_name`, `from` | shown, no override | Per the rule, overrides are only for defaults that are WRONG for us, not for merely-uninteresting fields. `from` is a real choice (send-as alias). |
| 8 | Card identity | New card `packages/ee/src/gmail/config.tsx`, `id: "gmail"`, `category: "Email"`, `active: !!GOOGLE_OAUTH_CLIENT_ID` | Rule: card id IS the piece name. `GOOGLE_OAUTH_CLIENT_ID` is already in `getBrowserEnv()`, so no env plumbing. `"Email"` is the existing category of the system-email card; Gmail sits beside it. |
| 9 | OAuth app | Reuse `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URL` | One Google Cloud app per vendor; Gmail is a scope on it, not a second app. Separate consent → separate `integrationConnection` row and refresh token per piece. |
| 10 | Account label | `{ url: "https://www.googleapis.com/oauth2/v2/userinfo", field: "email" }` | Identical to Calendar; `email` scope covers it. |
| 11 | Metadata | `{ scopes: "scope" }` | Google echoes granted scopes in the token response; feeds `missingScopes` → "Reconnect needed". |
| 12 | Uninstall | `hooks.server.ts` `gmail: { onUninstall: revokeConnectionsForPiece(…, "gmail", …) }` | One line, as Calendar and Slack. No per-vendor hooks file. |
| 13 | Label | `label: "Gmail"` | Emitted as the `integration.gmail` catalog label; not derived from the slug. |
| 14 | Card copy | Plain strings in `defineIntegration`, like every other card | Existing convention for integration cards; the step/label copy is Lingui-translated through the generated catalog as usual. |
| 15 | Version pin | `"@activepieces/piece-gmail": "0.13.0"` exact | `assertPinnedVersions` gate. 0.14.0 (published 2026-09-01) is refused by the repo's `minimumReleaseAge` (3 days); 0.13.0's `gmail_send_email` has identical props, output schema and scopes. **User decision.** |

### 1. Allowlist row (`packages/jobs/src/workflows/integrations/allowlist.ts`)

```ts
gmail: {
  package: "@activepieces/piece-gmail",
  version: "0.13.0",
  label: "Gmail",
  actions: ["gmail_send_email"],
  oauth: {
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    redirectUrlEnv: "GOOGLE_OAUTH_REDIRECT_URL",
    // Send-only. The piece also asks for gmail.readonly + gmail.compose, which are
    // Google "restricted" scopes: verifying an app that holds them requires an annual
    // third-party CASA security assessment. gmail.send is "sensitive" only.
    scope: ["https://www.googleapis.com/auth/gmail.send", "email"]
  },
  accountLabel: { url: "https://www.googleapis.com/oauth2/v2/userinfo", field: "email" },
  metadata: { scopes: "scope" },
  props: {
    gmail_send_email: {
      attachments: { omit: true },           // file objects; no Carbon input type
      in_reply_to: { omit: true },           // needs gmail.readonly (messages.list)
      draft: { omit: true, value: false }    // needs gmail.compose (drafts.create)
    }
  }
}
```

Resulting form (from the generic visibility rules): `connectionId`, `receiver` (list of
emails), `cc`, `bcc`, `subject`, `body`, `reply_to`, `sender_name`, `from`. Advanced:
`body_type` (`plain_text` | `html`). Outputs: `data.messageId`, `data.threadId`,
`data.labels`, `status`, `statusText`, plus the standard `count` and `result`.

The step is batchable like every piece step: wiring a list to `receiver` sends one email
per item (`receiver` is declared as a list, so under the batching fix in this branch it keeps
its list; a list wired to `subject` or `body` batches instead).

### 2. Generator, properties, visibility, outputs

No change. Every prop of `gmail_send_email` maps under the existing table (`ARRAY` →
`list<string>`, `SHORT_TEXT`, `STATIC_DROPDOWN`, `CHECKBOX`); the three overrides above are
`omit`, which Slack already introduced. `outputSchema` is present (`children` + `format`).
`pnpm run generate:workflow-catalog` must complete with no refusal — that is the gate.

### 3. Consent and callback

No change. `buildConsentUrl` already applies the row's `scope` override with
`access_type=offline&prompt=consent`; the callback already reads `accountLabel` and
`metadata` off the row and calls `markIntegrationInstalled("gmail")`.

### 4. Settings card (`packages/ee/src/gmail/config.tsx`, `packages/ee/src/index.ts`, `hooks.server.ts`)

- `defineIntegration({ name: "Gmail", id: "gmail", category: "Email", active: !!GOOGLE_OAUTH_CLIENT_ID, logo, shortDescription, description, images: [], settings: [], schema: z.object({}), onClientInstall: () => startIntegrationConnect("/api/integrations/connections/gmail/connect") })`.
- Copy: short "Send email from your workflows using a connected Google account."; long
  explains that each connected account sends as itself, that more than one account can be
  connected, and that only permission to send is requested (no reading of the mailbox).
- Logo: inline SVG "M" envelope in Gmail's four colours, `aria-label="Gmail"`.
- Register in the `integrations` array and export `Gmail` / `GmailLogo` from `index.ts`.
- `hooks.server.ts`: the one-line `onUninstall` entry.
- The Accounts tab, health check, builder "Connect Gmail" gating and reconnect prompts all
  key off `PIECE_ALLOWLIST["gmail"]` and need nothing.

### 5. Environment and Google Cloud (operational, not code)

- No new env vars. `.env.example` comment for the Google app widens from "(Google Calendar)"
  to "(Google Calendar, Gmail)".
- On the Google Cloud OAuth consent screen: add `…/auth/gmail.send` to the app's scopes and
  submit sensitive-scope verification (brand + privacy policy + a short demo video). Until
  approved, only listed test users can complete consent — same state Calendar is in today.

### 6. Tests

- `registry.test.ts`: the `gmail` row resolves, `gmail_send_email` loads, a non-allowlisted
  action (`gmail_search_email`) is refused.
- `oauth.test.ts`: `buildConsentUrl("gmail")` requests exactly `gmail.send email`, offline,
  prompt=consent; `requiredScopesFor("gmail")` returns the override.
- `visibility.test.ts` / `catalog.test.ts`: `attachments` and `in_reply_to` absent from
  inputs AND advancedInputs; `draft` absent and pinned `false` in `toPropsValue`; `body_type`
  in advancedInputs with value `plain_text`.
- `assertPinnedVersions` passes (`check:workflow-catalog`).

### 7. Docs

- `.claude/rules/workflow-integrations.md`: allowlist count "two" → "three (Google Calendar,
  Slack, Gmail)"; one paragraph under "Scope drift" noting the Gmail send-only choice and why.
- `packages/ee/AGENTS.md` / `packages/jobs/AGENTS.md`: mention the Gmail card and row.
- This spec's status → implemented; changelog entry.

## Data Model Changes

One row, no new columns: `20260901173000_workflow-integration-connections.sql` (this branch's
own migration, re-stamped past main's newest before the feature ships) inserts the `integration`
rows for BOTH pieces — `google-calendar` and `gmail` — because `companyIntegration.id` is an FK
to `integration.id` and the callback's `markIntegrationInstalled` insert fails without one. Found
during the first browser test (the spec originally said "None"); first added as its own migration,
then folded into the connections migration since nothing here is in production yet.
Then `integrationConnection` rows with `pieceName = "gmail"` and the `companyIntegration`
row `id = "gmail"` written by `markIntegrationInstalled`.

## API / Service Changes

None. Existing routes (`/api/integrations/connections/gmail/connect`, the shared callback,
`/api/workflows/options`) serve the new piece by name.

## UI Changes

- Settings → Integrations: a **Gmail** card (Email category), Coming soon without
  `GOOGLE_OAUTH_CLIENT_ID`; Details drawer shows the Accounts tab.
- Workflow builder: Integration node → app picker gains **Gmail**; step **Send Email**;
  "Connect Gmail" link when no account is connected.
- Run history: the step renders its typed outputs like any piece step.

## Acceptance Criteria

1. `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog` succeed and emit
   `integration.gmail.gmail_send_email` with inputs `connectionId, receiver, cc, bcc,
   subject, body, reply_to, sender_name, from` and advancedInputs `body_type` only.
2. With `GOOGLE_OAUTH_CLIENT_ID` unset the Gmail card reads "Coming soon"; set, it offers
   Install.
3. Install → consent popup: the Google screen lists ONLY "Send email on your behalf" and the
   email address; after consent the Accounts tab shows the account's email as its label and
   the card shows Installed.
4. The stored connection's `metadata.scopes` contains `gmail.send`; the vault holds the
   token; `metadata` holds no token (existing `connections.test.ts` invariant).
5. In a workflow, Integration → Gmail → Send Email with a literal recipient, subject and a
   body using a variable (`{{trigger.customer.name}}`): running it delivers the email from
   the connected address, the Sent folder shows it, and the run's step outputs carry a
   non-empty `messageId` and `threadId`.
6. Advanced → Body Type = `html` sends an HTML body; `draft`, `attachments`, `in_reply_to`
   are not offered anywhere in the node form.
7. Disconnecting the account makes the node form show the reconnect banner and the step fail
   before any vendor call with the standard reconnect copy.
8. Uninstalling Gmail revokes every `gmail` connection (`status = Revoked`, token deleted)
   and leaves Google Calendar connections untouched.
9. A second Google account can be connected under a different name and picked independently
   by another node.
10. `pnpm --filter @carbon/jobs test`, `--filter @carbon/ee test`, `--filter @carbon/workflows test`
    and the scoped typechecks (`@carbon/jobs`, `@carbon/ee`, `erp`) pass.

## Risks

- **Google verification lag.** Until sensitive-scope verification is approved, only test
  users can consent; the code is correct before that, so ship and verify in parallel.
- **Deliverability.** Mail sent via `messages.send` is ordinary user mail; a workflow that
  fires hundreds of sends per day can trip Gmail's per-user sending limits (500/day consumer,
  2,000/day Workspace). Documented in the card's long description; no throttling in v1.
- **`from` aliases.** A `from` not configured as a send-as alias in that Gmail account is
  rewritten by Google to the account's own address, silently. Surfaced in the prop's vendor
  description (already: "must be listed in your Gmail account's settings").
- **Scope creep pressure.** The first "reply to the customer's email" request needs
  `gmail.readonly`. The allowlist comment names the compliance cost so it is a conscious
  decision next time, not a one-line edit.

## Open Questions

- [x] Scope tier: send-only vs piece default (send + read/reply) — **Answer:** send-only
  (`gmail.send` + `email`). Restricted scopes would require an annual CASA assessment; one
  action covers the actual ask (outbound email from the company's own account).
- [x] Attachments in v1 (Carbon PDFs such as quotes and POs) — **Answer:** defer to a
  follow-up spec. Needs a file value type in the workflow engine; `attachments` is omitted
  from the step for now.
- [x] Card: separate Gmail card vs a shared Google card — **Resolved by precedent:** one card
  per piece, `id` === piece name (rule), sharing the Google OAuth app.
- [x] Version: 0.14.0 vs 0.13.0 — **Answer:** pin 0.13.0. pnpm's 3-day `minimumReleaseAge` refuses
  0.14.0 (published today); the send action is identical in both. Bump later is one line.
- [x] Which send action: `gmail_send_email` vs legacy `send_email` — **Resolved by research:**
  identical props and `run`; `gmail_send_email` is the maintained one with the structured
  output schema.

## Changelog

- 2026-09-01 — Draft written after research and the two user decisions above (scope tier,
  attachments).
- 2026-09-01 — Pin changed 0.14.0 → 0.13.0 during execution (release-age policy); user decision.
- 2026-09-01 — Implemented; run log `.ai/runs/2026-09-01-gmail-workflow-piece.md`.
- 2026-09-01 — First consent failed at `markIntegrationInstalled` (FK to `integration`); added the
  `integration` row migration, fixed the rule's checklist, and made the callback log PostgREST details.
- 2026-09-01 — Third browser test (builder): the To field offered only a variable picker and the
  body was a one-line box. Builder: `list<string>` inputs are a chip field (one chip per entry) stored as
  a list (`fields/control.ts` `isWritableList`, `LiteralControl`); jobs: `LONG_TEXT` maps to
  `template: true`, and a new allowlist prop override `template` marks Gmail's `ShortText` body as
  prose. Slack's message and Calendar's description gain the multiline editor too.
- 2026-09-01 — Second browser test: account connected but read "Reconnect needed" at once — Google
  reports the `email` alias as `…/auth/userinfo.email`. Both Google rows now spell scopes
  canonically; `oauth.test.ts` refuses aliases; pitfalls block added above `PIECE_ALLOWLIST`.
