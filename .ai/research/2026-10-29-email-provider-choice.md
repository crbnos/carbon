# Research: choose Gmail vs Resend for outgoing email

Verified excerpts (re-read 2026-10-29):
- `packages/jobs/src/inngest/functions/notifications/send-email.ts:54-103` — only `document: true` sends read the company `email` integration; only `provider === "server"` changes From/Reply-To; always calls global `sendEmail`.
- `packages/ee/src/email/config.tsx:40-90` — Email integration already has a "Delivery method" cards setting: server | resend | smtp, plus fromEmail, Resend apiKey, SMTP fields.

Subagent map (file:line cited, not all re-verified):
- Global transport: `packages/lib/src/email.server.ts:71-105` (SMTP_* env, else smtp.resend.com with RESEND_API_KEY). Per-company Resend/SMTP creds are only used by healthcheck (`packages/ee/src/email/hooks.server.ts:51-84`), never to send.
- Document send call sites (trigger "send-email", document: true): emailQuote `sales.service.ts:12346`, sendSalesOrderEmail `shared.service.ts:1257`, sendPostedSalesInvoice `invoicing.service.ts:5352`, PO `purchasing.service.ts:6947` + `purchasing.server.ts:2719`, RFQ `purchasing.server.ts:492`, supplier quote `purchasing.server.ts:780`.
- Bypass: `packages/jobs/src/invoicing/automate-invoice.ts:815` sends posted invoices directly via sendEmail, ignoring company settings.
- System mail (invites, verification codes, MFA, notifications, onboarding, changelog) always from server address.
- Gmail: workflow-only Activepieces piece (`packages/ee/src/gmail/config.tsx:14-24`), scope gmail.send + userinfo.email (`packages/jobs/src/workflows/integrations/allowlist.ts:298-350`), tokens in `integrationConnection` table (migration `20261026151302_workflow-integration-connections.sql`), refresh via `resolveConnectionAuth` (`packages/ee/src/integrations/connections.ts:579-713`) / `resolvePieceAuth` (`packages/jobs/src/workflows/integrations/piece-auth.ts:50-96`). No native Gmail API send exists.
- Patterns: providerRole single-active trigger (`20260924133915_integration-provider-role.sql`); conformance rule bans branching on integration ids outside `packages/ee/src/email/` (`packages/checks/src/conformance/no-integration-id-branching.ts`).
- No Outlook/Microsoft send integration.

## Decisions so far (user-confirmed)
- Choice lives in the existing Email integration "Delivery method" picker: add Gmail as a 4th card.
- Gmail carries all company mail: documents (incl. automated invoices), invites, MFA mails, notification emails. Login codes, onboarding/marketing, changelog, account-deletion warnings stay on Carbon's address.
- Build on Activepieces: send-email job resolves the Gmail connection token via `resolvePieceAuth` and runs the piece's `gmail_send_email` action directly (piece supports to/cc/bcc/subject/html/reply_to/sender_name/from/attachments — verified in `@activepieces/piece-gmail@0.13.0` bundle). Workflow allowlist's `attachments: omit` only limits the workflow UI.
