# Email provider choice (Gmail, Resend, SMTP, server mail) — implementation plan

**Spec / source:** `.ai/specs/2026-10-29-email-provider-choice.md`
**Research:** `.ai/research/2026-10-29-email-provider-choice.md`
**Branch:** `feat/email-provider-choice`
**Worktree:** `/Users/aashu/work/carbon/carbon-feat-email-provider-choice`

## Progress
- [x] Task 1: Add the Gmail delivery method to the Email integration (ee)
- [x] Task 2: Add a pure transport resolver to `delivery.ts` (ee)
- [x] Task 3: Add the Gmail healthcheck (ee)
- [x] Task 4: Split the shared SMTP send into reusable parts (lib)
- [x] Task 5: Mark "not sent" failures as retryable (jobs)
- [x] Task 6: Add the Gmail sender (jobs)
- [x] Task 7: Add `sendCompanyEmail` (jobs)
- [x] Task 8: Route the `send-email` job through `sendCompanyEmail` (jobs)
- [x] Task 9: Route the two job senders through `sendCompanyEmail` (jobs)
- [x] Task 10: Dispatch the ERP invite emails through the `send-email` event (erp)
- [x] Task 11: Fill the Gmail account select in the settings loader (erp)
- [x] Task 12: Update docs, rules and comments
- [ ] Task 13: End-to-end verification

## Deviations (recorded during execution)
- `sendCompanyEmail(serviceClient, companyId, payload)` takes the service client first. Importing `@carbon/auth/client.server` builds a client at import, which broke every job test that loads the module.
- New `@carbon/ee` subpath `./email/delivery` (re-exports `Email`). The `@carbon/ee` barrel and the Gmail descriptor reach `@carbon/auth` at import, so `packages/jobs/src/email/` imports only light modules and names the Gmail piece as `"gmail"`.
- The pure Gmail prop mapper lives in `gmail-props.ts`, so its test imports no server code.
- `sharedMailHeaders` names the company on a document even with no Email delivery. This keeps the automated invoice email's From (`"<Company>" <server address>`) unchanged.
- `companyFromAddress` in `automate-invoice.ts` has no production caller now. It is left in place with its test.
- `automate-invoice.test.ts`: the `@carbon/lib/email.server` mock gains `SERVER_MAIL_CONFIGURED`; the From expectation is now the `{ name, address }` object (same rendered header).
- `email.server.test.ts`: the Resend fallback assertion uses `expect.objectContaining`, as its sibling tests do.
- `pnpm install` and `pnpm --filter @carbon/config build` were needed once in the fresh worktree.

- Review fixes (`.ai/reviews/2026-10-29-email-provider-choice-review.md` B1–B3, C1–C3): the save action exempts Gmail from the credential check (`picksCredentialFreeEmail`); `parseEmailSettings` is the one schema read and holds the one legacy "no provider = Resend" default; `companyTransport(resolvedMetadata)` returns only `smtp | gmail`; `documentSender` folded into `sharedMailHeaders` (takes `companyAddress`); `EmailDelivery` no longer carries `gmailConnectionId`; `companyFromAddress` deleted.

## Dependencies
- Task 2 needs Task 1. Task 3 needs Task 1.
- Task 4 and Task 5 are independent of each other and of Tasks 1–3.
- Task 6 needs Task 5. Task 7 needs Tasks 2, 4 and 6.
- Tasks 8 and 9 need Task 7. Task 10 needs Task 8.
- Task 11 needs Task 1.
- Task 12 needs Tasks 1–11. Task 13 needs all tasks.

## Rules for the executor
- Work only in the worktree above. Never `cd` to `/Users/aashu/work/carbon/carbon`.
- 🛑 Never run `git commit`. The user commits.
- Run one heavy command (typecheck, test) at a time. Check free RAM first with `vm_stat | head -5`.
- Every new source file starts with its SPDX header. After you create files, run `pnpm --filter @carbon/checks license-headers`.
- Log before you throw (`.claude/rules/coding-conventions.md` → Errors).

---

## Task 1: Add the Gmail delivery method to the Email integration (ee)

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/email/config.tsx` — new card, new setting, new schema variant, descriptions
- Modify: `packages/ee/src/email/delivery.ts` — widen `EmailDelivery`, read `gmailConnectionId`, extend `emailSettingsForm`
- Modify: `packages/ee/src/email/delivery.test.ts` — new cases
- Copy from (precedent): the `smtp` card and its `visibleWhen` settings in the same `config.tsx`

**Steps:**
1. In `config.tsx`, add a fourth `listOptions` entry to the `provider` setting, after `smtp`:
   ```ts
   {
     value: "gmail",
     label: "Gmail",
     description: "Send as a Google account you connected on the Gmail integration."
   }
   ```
2. Hide `fromEmail` for Gmail. Add `visibleWhen: { field: "provider", equals: ["server", "resend", "smtp"] }` to the `fromEmail` setting.
3. Add a new setting after the SMTP group's settings:
   ```ts
   {
     name: "gmailConnectionId",
     label: "Gmail account",
     description: "The connected Google account that sends your email. Connect one on the Gmail integration first.",
     type: "options",
     required: true,
     value: "",
     listOptions: [],
     visibleWhen: { field: "provider", equals: "gmail" }
   }
   ```
4. Add this variant to the `z.discriminatedUnion("provider", [...])` schema:
   ```ts
   z.object({
     provider: z.literal("gmail"),
     gmailConnectionId: z.string().min(1, { message: "Pick a Gmail account" })
   })
   ```
5. Update `description` and `shortDescription` to name Gmail: "…, or pick Resend, Custom SMTP or Gmail to send from your own account." and "…via this server's mail settings, Resend, a custom SMTP server, or Gmail."
6. In `delivery.ts`:
   - Widen `EmailDelivery.provider` to `"server" | "resend" | "smtp" | "gmail"`.
   - Add `gmailConnectionId?: string` to `EmailDelivery`.
   - In `resolveEmailDelivery`, read `metadata.gmailConnectionId` when it is a non-empty string and return it on the delivery. If `provider === "gmail"` and there is no `gmailConnectionId`, return `null` (it cannot send).
7. Extend `emailSettingsForm` with a third parameter `gmailAccounts: Array<{ id: string; accountLabel: string | null; name: string; status: string }>`. Return a new field `gmailConnectionOptions`: the accounts with `status === "Active"`, mapped to `{ value: id, label: accountLabel ?? name }`. Keep the existing `providerOptions` and `initialMetadata` logic unchanged.
8. In `delivery.test.ts`, add these cases to `describe("resolveEmailDelivery")`:
   - "keeps a Gmail delivery with its connection" → `{ provider: "gmail", gmailConnectionId: "conn_1" }`.
   - "cannot send through Gmail without a connection" → `null`.
9. Add `describe("emailSettingsForm")` with one case: "offers only Active Gmail accounts, labelled by their address".

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/email/delivery.test.ts
# Expected: all tests pass, including the 3 new ones
```

**Out of scope:** the integration form component (`IntegrationForm.tsx`); it already renders `options` and `visibleWhen`. Do not add Lingui to `config.tsx`: no integration config uses it.

---

## Task 2: Add a pure transport resolver to `delivery.ts` (ee)

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/email/delivery.ts` — add `companyTransport`
- Modify: `packages/ee/src/email/delivery.test.ts` — tests
- Modify: `packages/ee/src/index.ts` — export `companyTransport` and its type next to `resolveEmailDelivery`

**Steps:**
1. Add the type and the function. The function takes metadata whose secrets are already resolved:
   ```ts
   export type CompanyTransport =
     | { kind: "shared" }
     | { kind: "smtp"; host: string; port: number; secure: boolean;
         user: string; pass: string; fromEmail: string }
     | { kind: "gmail"; connectionId: string };

   /** Where a company's mail goes, from its Email settings with secrets resolved. */
   export function companyTransport(
     delivery: EmailDelivery | null,
     resolvedMetadata: unknown
   ): CompanyTransport
   ```
2. Rules, in this order:
   1. If `delivery` is null or `delivery.provider === "server"`, return `{ kind: "shared" }`.
   2. If `delivery.provider === "gmail"`, return `{ kind: "gmail", connectionId: delivery.gmailConnectionId! }`.
   3. Parse `resolvedMetadata` with `Email.schema` (add `provider: "resend"` first when it has none, as `emailHealthcheck` does). If the parse fails, throw `new Error("The company's Email settings are incomplete")`.
   4. For `resend`, return `{ kind: "smtp", host: "smtp.resend.com", port: 465, secure: true, user: "resend", pass: apiKey, fromEmail }`.
   5. For `smtp`, return `{ kind: "smtp", host, port, secure, user: username, pass: password, fromEmail }`.
3. Add tests: one per rule (5 cases), plus "throws when the Resend key is missing".

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/email/delivery.test.ts
# Expected: all tests pass
```

**Out of scope:** reading the database or the vault. This function is pure.

---

## Task 3: Add the Gmail healthcheck (ee)

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/email/hooks.server.ts` — new `gmail` branch in `emailHealthcheck`

**Steps:**
1. Rename the unused `_companyId` parameter to `companyId`.
2. After `if (data.provider === "server") …`, add:
   ```ts
   if (data.provider === "gmail") {
     const connection = await readConnection(getCarbonServiceRole(), companyId, data.gmailConnectionId);
     return connection?.pieceName === Gmail.id && connection.status === "Active";
   }
   ```
3. Import `readConnection` from `../integrations/connections`, `Gmail` from `../gmail/config`, and `getCarbonServiceRole` from `@carbon/auth/client.server`. The existing `try/catch` already turns a thrown read into `false`; keep the branch inside the `try`.
4. Update the JSDoc list at the top of the function with a `gmail` line.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no errors
```

**Out of scope:** the Gmail integration's own healthcheck (`pieceHooks`).

---

## Task 4: Split the shared SMTP send into reusable parts (lib)

**Depends on:** none
**Files:**
- Modify: `packages/lib/src/email.server.ts`

**Steps:**
1. Export a transport builder:
   ```ts
   export type SmtpTransportConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string };
   export function createSmtpTransport(config: SmtpTransportConfig): Transporter
   ```
   Build it with the same options as the `SMTP_HOST` branch: `requireTLS: !config.secure && Boolean(auth)`.
2. Export the send body as `deliverEmail(transport: Transporter, payload: SendEmailPayload): Promise<SendEmailResult>`. Move the `try { transport.sendMail(...) } catch …` block of `sendEmail` into it without changes.
3. Make `sendEmail` call `getTransporter()`, keep the "not configured" early return, then `return deliverEmail(transport, payload)`.
4. Make the `SMTP_HOST` branch and the `RESEND_API_KEY` branch of `getTransporter` call `createSmtpTransport`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: no errors
pnpm --filter @carbon/lib test
# Expected: all tests pass
```

**Out of scope:** `DEFAULT_FROM`, `SERVER_MAIL_CONFIGURED`, the lazy-transport rule.

---

## Task 5: Mark "not sent" failures as retryable (jobs)

**Depends on:** none
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/delivery-failure.ts`
- Modify: `packages/jobs/src/inngest/functions/notifications/delivery-failure.test.ts`

**Steps:**
1. Add `"ENOTSENT"` to `RETRYABLE_SMTP_CODES`. Add a comment: "Ours: set by the company sender when it stopped before any vendor call (a Gmail token refresh held by another caller)."
2. Export `export const NOT_SENT = "ENOTSENT";`.
3. Add a test: an error with `code: "ENOTSENT"` is retryable.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/inngest/functions/notifications/delivery-failure.test.ts
# Expected: all tests pass
```

**Out of scope:** the Slack codes.

---

## Task 6: Add the Gmail sender (jobs)

**Depends on:** Task 5
**Files:**
- Create: `packages/jobs/src/email/gmail.ts`
- Create: `packages/jobs/src/email/gmail.test.ts`
- Copy from (precedent): `packages/jobs/src/workflows/actions/integration.ts` (`runIntegrationAction`, lines 170–243)

**Steps:**
1. Write the pure prop mapper:
   ```ts
   export function gmailSendProps(
     payload: SendEmailPayload,
     senderName: string,
     attachments: Array<{ filename: string; base64: string }>
   ): Record<string, unknown>
   ```
   It returns:
   - `receiver`: `payload.to` as an array.
   - `cc`, `bcc`: arrays, or omitted when unset.
   - `subject`: `payload.subject`.
   - `body_type`: `"html"` when `payload.html` is set, else `"plain_text"`.
   - `body`: `payload.html ?? payload.text ?? ""`.
   - `reply_to`: `payload.replyTo` split on `","` and trimmed, or omitted.
   - `sender_name`: `senderName`.
   - `attachments`: each as `{ file: { filename, base64, extension: <text after the last "."> } }`.
   - `draft`: `false`.
   - Do not set `from`. The piece reads the account's address itself.
2. Write the sender:
   ```ts
   export async function sendViaGmail(
     serviceClient: SupabaseClient<Database>,
     companyId: string,
     connectionId: string,
     senderName: string,
     payload: SendEmailPayload
   ): Promise<SendEmailResult>
   ```
   Do these steps, in order:
   1. Call `resolvePieceAuth(serviceClient, companyId, "gmail", connectionId)` from `../workflows/integrations/piece-auth`.
   2. If the result is not `ok`, return `{ data: null, error }`. Build `error` as `new Error("Gmail cannot send: <reason>")`. If the reason is `"refreshing"`, set `error.code = NOT_SENT`.
   3. Turn each attachment into `{ filename, base64 }`. Use `content` as-is. For a `path` attachment, `fetch(path)` and base64 the body. If the fetch fails, return `{ data: null, error }`.
   4. Load the action with `getPieceAction("gmail", "gmail_send_email")` from `../workflows/integrations/registry`.
   5. Call `action.run(buildPieceContext({ auth: { access_token }, propsValue }))`. Import `buildPieceContext` from `../workflows/integrations/context`.
   6. If it throws, log it with `getLogger("jobs", "gmail-email")` and return `{ data: null, error }`.
   7. Else return `{ data: { id: result?.data?.id ?? "gmail" }, error: null }`.
3. If `getPieceAction("gmail", "gmail_send_email")` throws `UnknownPieceActionError`, STOP and report. The allowlist must keep that action.
4. In `gmail.test.ts`, pin the prop names: build props for a payload with to, cc, replyTo, html and one attachment. Assert the exact keys `receiver`, `cc`, `subject`, `body_type`, `body`, `reply_to`, `sender_name`, `attachments`, `draft`.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/email/gmail.test.ts
# Expected: all tests pass
```

**Out of scope:** the workflow allowlist's `attachments: { omit: true }`. Leave workflows unchanged.

---

## Task 7: Add `sendCompanyEmail` (jobs)

**Depends on:** Tasks 2, 4, 6
**Files:**
- Create: `packages/jobs/src/email/company-email.ts`
- Modify: `packages/ee/src/email/delivery.ts` and `delivery.test.ts` — `sharedMailHeaders`
- Copy from (precedent): the integration read and `documentSender` call in `packages/jobs/src/inngest/functions/notifications/send-email.ts` (lines 51–103)

**Steps:**
1. Define the input and the function:
   ```ts
   export type CompanyEmailPayload = Omit<SendEmailPayload, "from"> & {
     /** A quote, order, invoice, PO or RFQ: on server mail, From carries the company name. */
     document?: boolean;
   };
   export async function sendCompanyEmail(companyId: string, payload: CompanyEmailPayload): Promise<SendEmailResult>
   ```
2. Do these steps, in order:
   1. `const client = getCarbonServiceRole()`.
   2. Read `companyIntegration` with `.select("active, metadata, secretRef").eq("id", Email.id).eq("companyId", companyId).maybeSingle()`. On error, log and throw the error.
   3. `const delivery = resolveEmailDelivery(row, SERVER_MAIL_CONFIGURED)`.
   4. Read the company name once: `client.from("company").select("name").eq("id", companyId).maybeSingle()`. On error, log and throw.
   5. If `delivery?.provider` is not one of `resend`, `smtp`, `gmail`, use the shared path. If `payload.document`, compute `documentSender(delivery, name, DEFAULT_FROM)`. Return `sendEmail({ ...payload, from: sender.from, replyTo: <payload.replyTo and sender.replyTo, de-duplicated, joined with ", "> })`.
   6. Else resolve secrets: `resolveIntegrationSecrets(client, companyId, Email.id, row.metadata, row.secretRef)`.
   7. `const transport = companyTransport(delivery, resolved)`.
   8. For `kind: "smtp"`, return `deliverEmail(createSmtpTransport(transport), { ...payload, from: { name: companyName, address: transport.fromEmail } })`.
   9. For `kind: "gmail"`, return `sendViaGmail(client, companyId, transport.connectionId, companyName, payload)`.
   - `companyName` is the company's name, or `"Carbon"` when it has none.
3. Imports: `Email`, `companyTransport`, `documentSender`, `resolveEmailDelivery` and `resolveIntegrationSecrets` from `@carbon/ee`, the same root `send-email.ts` imports. Import `DEFAULT_FROM`, `SERVER_MAIL_CONFIGURED`, `sendEmail`, `deliverEmail`, `createSmtpTransport` and the types from `@carbon/lib/email.server`.
4. If `resolveIntegrationSecrets` is not exported from the `@carbon/ee` root, import it from `@carbon/ee/integrations/secrets`. If neither path exports it, STOP and report.
5. Move the server-mail header rule into `packages/ee/src/email/delivery.ts` as a pure function, so it is tested by value (`.claude/rules/testing.md`: no mocks of first-party modules):
   ```ts
   export function sharedMailHeaders(
     delivery: EmailDelivery | null,
     args: { document: boolean; companyName: string | null | undefined; replyTo?: string },
     serverFrom: string
   ): { from?: { name: string; address: string }; replyTo?: string }
   ```
   It returns `documentSender(...)`'s From when `document` is true, else no From. Its `replyTo` is `args.replyTo` and the sender's Reply-To, de-duplicated and joined with `", "`, or `undefined` when both are empty. `sendCompanyEmail` uses it in step 5.
6. Add `describe("sharedMailHeaders")` to `delivery.test.ts`. Move the 4 cases of `send-email.test.ts` there as value tests. Do not write a `company-email.test.ts`: the glue is covered by typecheck and Task 13.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/email/delivery.test.ts
# Expected: all tests pass, including the sharedMailHeaders cases
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no errors
```

**Out of scope:** Carbon's own mail (login codes, onboarding, changelog, weekly deletion warning). Those keep calling `sendEmail`.

---

## Task 8: Route the `send-email` job through `sendCompanyEmail` (jobs)

**Depends on:** Task 7
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/send-email.ts`
- Delete: `packages/jobs/src/inngest/functions/notifications/send-email.test.ts`

**Steps:**
1. Delete the integration read, the `resolveEmailDelivery` call, the company read and the `documentSender` call (lines 51–92).
2. Replace the `sendEmail` call with:
   ```ts
   const response = await sendCompanyEmail(payload.companyId, {
     attachments: payload.attachments,
     cc: ccRecipients,
     document: payload.document === true,
     html: payload.html,
     replyTo: payload.from || undefined,
     subject: payload.subject,
     text: payload.text,
     to: toRecipients
   });
   ```
3. Keep the `emailDeliveryFailure` throw, the `data: null` comment and the tracking step unchanged.
4. Remove the now-unused imports.
5. Delete `send-email.test.ts`. Its 4 From/Reply-To cases moved to `sharedMailHeaders` in Task 7, and the rest of the job is glue (`.claude/rules/testing.md` → When a test breaks on a refactor).

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/inngest/functions/notifications
# Expected: all tests pass
```

**Out of scope:** the event schema in `packages/lib/src/events.ts` (Task 12 updates only its comment).

---

## Task 9: Route the two job senders through `sendCompanyEmail` (jobs)

**Depends on:** Task 7
**Files:**
- Modify: `packages/jobs/src/invoicing/automate-invoice.ts` — the `sendEmail` call near line 815
- Modify: `packages/jobs/src/inngest/functions/tasks/user-admin.ts` — the `sendEmail` call near line 107

**Steps:**
1. In `automate-invoice.ts`, replace `sendEmail({ from: companyFromAddress(...), … })` with `sendCompanyEmail(companyId, { document: true, to, cc, replyTo, subject, html, text, attachments })`. Drop `from`.
2. Keep `companyFromAddress` and its export: its tests may use it. If nothing else calls it after this change, leave it and report it.
3. In `user-admin.ts`, replace `sendEmail({...})` with `sendCompanyEmail(companyId, {...})`, with the same fields. Check that `companyId` is in scope at that line. If it is not, STOP and report.
4. Remove the now-unused `sendEmail` and `DEFAULT_FROM` imports.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no errors
pnpm --filter @carbon/jobs exec vitest run src/invoicing
# Expected: all tests pass
```

**Out of scope:** `onboard.ts`, `weekly.ts`, `changelog-dispatch.ts`, `verification.server.ts`.

---

## Task 10: Dispatch the ERP invite emails through the `send-email` event (erp)

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/users/users.service.ts` — `sendInviteEmail` (near line 2318)
- Modify: `apps/erp/app/routes/_public+/invite.$code.tsx` — the `sendEmail` call near line 241
- Copy from (precedent): the `trigger("send-email", …)` call in `apps/erp/app/modules/shared/shared.service.ts` (`notifyImplementationHubAdmins`, near line 1821)

**Steps:**
1. In `sendInviteEmail`, render the HTML first. Then call:
   ```ts
   await trigger("send-email", {
     to: invite.email,
     subject: `You have been invited to join ${invite.companyName} on Carbon`,
     html,
     text: await render(<same element>, { plainText: true }),
     companyId: ctx.company.id
   });
   ```
   Import `trigger` from `@carbon/jobs`.
2. The event has no `headers` field, so `X-Entity-Ref-ID` is dropped. Delete the `nanoid` import if nothing else uses it.
3. Do the same in `invite.$code.tsx`. Use `invite.data.companyId` for `companyId`. If the invite row does not select `companyId`, add it to that select.
4. Remove the now-unused `sendEmail` imports.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** `verification.server.ts` and the login route; login codes stay on Carbon's address.

---

## Task 11: Fill the Gmail account select in the settings loader (erp)

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — loader, near line 531

**Steps:**
1. Before the `emailSettingsForm` call, read the company's Gmail accounts only for the Email integration:
   ```ts
   const gmailAccounts =
     integrationId === Email.id ? await readConnections(client, companyId, Gmail.id) : [];
   ```
   Import `readConnections` from `@carbon/ee/integrations/connections`, and `Email` and `Gmail` from `@carbon/ee`. If a root import of `Gmail` fails, use the same import path the file already uses for `Email`.
2. Pass `gmailAccounts` as the third argument of `emailSettingsForm`.
3. After the `providerOptions` block, add:
   ```ts
   if (emailForm) dynamicOptions.gmailConnectionId = emailForm.gmailConnectionOptions;
   ```
4. If `readConnections` throws, log it with the route logger and use `[]`. The Email page must still open.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm --filter @carbon/checks test
# Expected: all tests pass (no-integration-id-branching included)
```

**Out of scope:** the action. The generic save already validates against `Email.schema`.

---

## Task 12: Update docs, rules and comments

**Depends on:** Tasks 1–11
**Files:**
- Modify: `packages/lib/src/events.ts` — the `document?: true` comment
- Modify: `docs/content/docs/integrations/email.mdx` — Gmail section, plus what each method sends
- Modify: `.claude/rules/email-design.md` — the "Sending" row
- Modify: `.claude/rules/environment-configuration.md` — the **Email** paragraph
- Modify: `packages/lib/AGENTS.md` — the `send-email` dispatch line, if it names the From rule
- Modify: `.ai/specs/2026-10-29-email-provider-choice.md` — status `in-progress`, changelog line

**Steps:**
1. In `events.ts`, change the `document` comment to: "A quote, order, invoice, purchase order or RFQ. Every event follows the company's Email settings; on server mail this flag also puts the company's name on the From."
2. In `email.mdx`, add a "Gmail" section: connect a Google account on the Gmail integration, then pick Gmail and the account under Email → Delivery method. State the 4 kinds of mail it sends and the ones that stay on Carbon's address. State that Gmail has a daily send limit. Do not name a customer.
3. In `email-design.md`, change the "Sending" row: the `send-email` event and `sendCompanyEmail` follow the company's delivery method; `sendEmail` is for Carbon's own mail only.
4. In `environment-configuration.md`, add one sentence: a company's own Resend, SMTP or Gmail setting overrides these variables for that company's mail.
5. Run the STE-80 review pass (`.claude/rules/writing-ste.md`) on the spec and this plan.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: no errors
```

**Out of scope:** the changelog entry; the user decides when to write one.

---

## Task 13: End-to-end verification

**Depends on:** all tasks
**Files:** none

**Steps:**
1. Run each command below, one at a time.
2. Report every failure with its output. Do not mark the plan done while one fails.
3. Ask the user before you start the app (`crbn up`) for a browser check. The manual checks need a Gmail account connected on the local stack.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/lib --filter=@carbon/jobs
# Expected: no errors
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm --filter @carbon/ee test
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/checks test
# Expected: all pass
pnpm exec biome check packages/ee/src/email packages/jobs/src/email packages/lib/src/email.server.ts packages/jobs/src/inngest/functions/notifications apps/erp/app/modules/users/users.service.ts "apps/erp/app/routes/_public+/invite.\$code.tsx" "apps/erp/app/routes/x+/settings+/integrations.\$id.tsx"
# Expected: no errors
```

Manual checks (with the user's go-ahead), one per spec acceptance criterion:
1. Settings → Integrations → Email: pick Gmail, pick the account, save. The card reads healthy.
2. Finalize a quote with Email. The customer address gets it from the Gmail account, PDF attached.
3. Invite a user. The invite comes from the Gmail account.
4. Revoke the Gmail connection, send a PO. The job fails; no mail goes out from another address.

**Out of scope:** committing. The user commits.
