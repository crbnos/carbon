---
paths:
  - packages/ee/src/email/**
  - packages/ee/src/gmail/**
  - packages/ee/src/google-calendar/**
  - packages/ee/src/email-notifications/**
  - packages/jobs/src/email/**
  - packages/jobs/src/inngest/functions/notifications/send-email.ts
  - packages/jobs/src/inngest/functions/notifications/delivery-failure.ts
  - packages/lib/src/email.server.ts
  - apps/erp/app/routes/x+/settings+/integrations.$id.tsx
---

# Email, Gmail and Google Calendar integrations

Three integration cards in `packages/ee/src/index.ts` `integrations[]`. **Email** decides
how a company's mail goes out. **Gmail** and **Google Calendar** are Activepieces piece
cards that connect Google accounts. A workflow step acts as one of those accounts, and
Email can send a company's mail through a Gmail account. The piece machinery (allowlist,
`integrationConnection`, OAuth round trip, token refresh) is in `workflow-integrations.md`.
Email templates are in `email-design.md`. User docs: `docs/content/docs/integrations/email.mdx`
and `docs/content/docs/integrations/workflow-apps.mdx`.

Specs: `.ai/specs/2026-10-29-email-provider-choice.md` (delivery methods, Gmail sending)
and `.ai/specs/implemented/2026-09-01-gmail-workflow-piece.md` (send-only Gmail).

## Overview

| Card | id | `active` | Plan gate | What it holds |
|---|---|---|---|---|
| Email | `email` | `true` | none: `INTEGRATION_WHITELIST` (`plan.ts`) bypasses `INTEGRATIONS` | `companyIntegration` row, metadata = the delivery method |
| Gmail | `gmail` | `!!GOOGLE_CLIENT_ID` | `INTEGRATIONS` | `integrationConnection` rows, `pieceName = 'gmail'` |
| Google Calendar | `google-calendar` | `!!GOOGLE_CLIENT_ID` | `INTEGRATIONS` | `integrationConnection` rows, `pieceName = 'google-calendar'` |

- One Google OAuth app serves both piece cards: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_OAUTH_REDIRECT_URL` (allowlist `oauth`, `packages/jobs/src/workflows/integrations/allowlist.ts`).
  Unset `GOOGLE_CLIENT_ID` shows both cards as "Coming soon". Each card connects its own accounts.
- Gmail asks only for `gmail.send` and `userinfo.email`. Never add a read, compose or
  draft scope: Google classes them as restricted (see `workflow-integrations.md`).
- `email-notifications` is NOT an integration. `emailNotificationsEnabled`
  (`email-notifications/deliver.server.ts`) is the `EMAIL_NOTIFICATIONS` plan gate for the
  email channel of the `notify` job (`notify.ts`, step `check-email-plan`). It degrades:
  a company without the feature gets no notification email, and in-app and Slack still go
  out. It does not decide the transport. The Email integration decides that.

## Key files

- `packages/ee/src/email/config.tsx` — `Email` descriptor. Settings: `provider` ("Delivery
  method": `server` "Server mail", `resend`, `smtp` "Custom SMTP", `gmail`), `fromEmail`,
  `apiKey`, `host`, `port`, `username`, `password`, `secure` ("Use TLS"), `gmailConnectionId`.
  `schema` is a `z.discriminatedUnion("provider", …)`.
- `packages/ee/src/email/delivery.ts` (`@carbon/ee/email/delivery`, light: no env check at
  import) — `parseEmailSettings`, `resolveEmailDelivery`, `companyMailRoute`,
  `sharedMailHeaders`, `companyTransport`, `withEmailDelivery`, `emailSettingsForm`,
  `picksServerMail`, `picksCredentialFreeEmail`. Tests: `delivery.test.ts`.
- `packages/ee/src/email/hooks.server.ts` — `emailHealthcheck`, registered as
  `serverHooks.email.onHealthcheck` in `packages/ee/src/hooks.server.ts`.
- `packages/ee/src/gmail/config.tsx`, `packages/ee/src/google-calendar/config.tsx` — one
  `definePieceIntegration` call each (`integrations/piece-integration.ts`). No settings form.
- `packages/jobs/src/email/company-email.ts` — `sendCompanyEmail`, the one sender of company mail.
- `packages/jobs/src/email/gmail.ts` — `sendViaGmail`, `GmailSendingLimitError`.
  `gmail-props.ts` — `gmailSendProps`. `sending-limit.ts` — `notifyGmailSendingLimit`.
- `packages/jobs/src/inngest/functions/notifications/send-email.ts` — `sendEmailFunction`
  (Inngest id `send-email`, event `carbon/send-email`, `retries: 3`).
- `packages/jobs/src/inngest/functions/notifications/delivery-failure.ts` —
  `emailDeliveryFailure`, `isSendingLimitResponse`, `isRateLimitedResponse`, `NOT_SENT`.
- `packages/lib/src/email.server.ts` — `sendEmail` (the server transport), `deliverEmail`,
  `createSmtpTransport`, `DEFAULT_FROM`, `SERVER_MAIL_CONFIGURED`.

## Data flow

**Which path a message takes**

| Mail | Path | Transport |
|---|---|---|
| Quotes, orders, invoices, POs, RFQs, invites, notification emails | `trigger("send-email", { companyId, … })` → `sendEmailFunction` → `sendCompanyEmail` | The company's Email settings |
| Invoice automation, invite resend | `sendCompanyEmail` directly (`invoicing/automate-invoice.ts`, `tasks/user-admin.ts`) | The company's Email settings |
| Sign-in codes, onboarding, the weekly inactive-company warning, changelog | `sendEmail` (`verification.server.ts`, `onboard.ts`, `weekly.ts`, `changelog-dispatch.ts`) | Always the server transport |
| A workflow's "Gmail: Send Email" step | `runIntegrationAction` (`workflow-integrations.md`) | The connection the node names |

**`sendCompanyEmail(serviceClient, companyId, payload)`**

1. Read the `email` `companyIntegration` row and `company.name` with the service role.
   A read error throws, so the job retries.
2. `companyMailRoute(row, SERVER_MAIL_CONFIGURED)` returns one route:
   - `shared` — no active Email row, or `provider = server`. Send with `sendEmail` and
     `sharedMailHeaders`. A `document` message keeps the server's From address and puts the
     company name in its display name. Its Reply-To adds the company's `fromEmail`.
   - `own` — Resend, SMTP or Gmail.
   - `unusable` — an active row whose method cannot send (Gmail with no account,
     `server` on a server without mail settings). Return an error. Never fall back.
3. For `own`, resolve vaulted secrets with `resolveIntegrationSecrets`, unless
   `picksCredentialFreeEmail` (server, Gmail).
4. `companyTransport(resolved)`. Resend is SMTP to `smtp.resend.com:465` with user
   `resend` and the API key as password. An incomplete row returns an error.
5. `kind: "smtp"` → `deliverEmail(createSmtpTransport(…))`, From = company name + `fromEmail`.
6. `kind: "gmail"` → `sendViaGmail`: `resolvePieceAuth(…, "gmail", connectionId)`, read the
   attachments to base64, `gmailSendProps`, then run the piece action `gmail_send_email`
   with `buildPieceContext`. The piece sends as the account. `sender_name` is the company name.
7. On `GmailSendingLimitError`, `notifyGmailSendingLimit` sends one in-app
   `IntegrationSync` notification per day to the row's `updatedBy`. Redis key
   `integrations:<companyId>:email:gmail-sending-limit`, TTL 24 h, `NX`.

**Retries.** `sendEmailFunction` throws `emailDeliveryFailure(error)`. A failure is retried
only when nothing could have reached the vendor (`code: NOT_SENT`). `sendViaGmail` marks
these `NOT_SENT`: auth reasons `refreshing` and `failed`, an attachment that failed to
download, and a Gmail rate limit. A sending-limit refusal and any other vendor error are
final: the message may have gone out.

**ERP shell.** `x+/_layout.tsx` passes the integrations through `withEmailDelivery`. A
company with no Email row on a server with mail settings gets a synthetic active `email`
row (`provider: "server"`). A row whose method cannot send reads `active: false`. So
`integrations.has("email")` answers "can this company email a document".

## Settings

- `emailSettingsForm` builds the form per server. With `SERVER_MAIL_CONFIGURED`, Server mail
  is offered and a fresh install starts on it. Without it, `server` is left out of the options.
- The Gmail account options are the company's `gmail` connections with `status = 'Active'`
  (`readConnections` in the `integrations.$id.tsx` loader). An Expired one needs a
  reconnect on the Gmail card first.
- The `integrations.$id.tsx` action refuses Server mail on a server without mail settings
  ("This server has no mail settings. …"). The install-time secret check skips
  `picksCredentialFreeEmail` methods. `SECRET_KEYS.email` is `["apiKey", "password"]`.
- `fromEmail` is required for Resend and SMTP, optional for server mail, hidden for Gmail.
- A legacy row with no `provider` reads as `resend` (`withLegacyProvider`).
- `emailHealthcheck`: server → `SERVER_MAIL_CONFIGURED`; Resend → `GET /domains` (2xx, or
  401 `restricted_api_key`, is healthy); SMTP → `nodemailer` `verify()`; Gmail → the
  connection is `gmail` and `Active`. It never throws.

## Gotchas

- `SERVER_MAIL_CONFIGURED` is `SINGLE_TENANT && Boolean(SMTP_HOST)`. On Carbon Cloud
  (multi-tenant) it is false even with SMTP set, so a company there needs its own method.
  `RESEND_API_KEY` alone still sends Carbon's own mail, never a company's documents.
- `sendEmail` returns `{ data: null, error: null }` when the server has no transport. That
  means "email is off", not a failure. `sendEmailFunction` then records no delivery.
- Gmail cannot set custom headers: `gmailSendProps` drops `headers` (an invite's
  `X-Entity-Ref-ID`). It sends one body part: html when present, else text.
- `secure` posts the strings `"true"` / `"false"`. The schema preprocesses them; do not
  replace it with `z.coerce.boolean()`, which reads both as true.
- `sendCompanyEmail` needs the service role: it reads vaulted secrets and the Gmail token.
- `@carbon/jobs` imports `@carbon/ee/email/delivery`, never the `@carbon/ee` barrel. The
  barrel validates the server env at import, and every job test would need it.
- Uninstalling Gmail revokes its connections (`pieceHooks`), but Email keeps its
  `gmailConnectionId`. The route stays `own`, so every send fails with
  `Gmail cannot send: <reason>` (`resolvePieceAuth`) and `emailHealthcheck` reads unhealthy,
  until someone picks another method or account.

## Never

- Never send company mail with `sendEmail` directly. Use `trigger("send-email", …)` or
  `sendCompanyEmail`, or the company's Email settings are ignored.
- Never fall back to another transport when the chosen one fails. Mail from an
  unexpected address is worse than an error the user can see.
- Never send a company document From the company's own address over the server transport.
  One server hosts many companies: the company goes in the display name and Reply-To.
- Never put a Gmail token in `companyIntegration.metadata`. Email stores only
  `gmailConnectionId`; the token stays in the connection's vault secret.
