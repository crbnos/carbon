---
paths:
  - "packages/documents/src/email/**"
  - "packages/jobs/src/inngest/functions/notifications/**"
  - "packages/jobs/src/inngest/functions/scheduled/changelog-dispatch.ts"
  - "packages/jobs/src/changelog/**"
---

# Email Design — every email is the notification card

Carbon sends one kind of email: the **card** that `NotificationEmail` renders
(`packages/documents/src/email/NotificationEmail.tsx`). Transactional, lifecycle, and
broadcast emails (`MfaRequiredEmail`, `ChangelogEntryEmail`, …) are
the same card with different copy. A new email that looks different from a notification
is a bug, not a design choice. Grounded in the templates and `components/` in that folder.

## Where things live

| What | Where |
|---|---|
| Templates | `packages/documents/src/email/*.tsx`, exported from `index.ts` → `@carbon/documents/email` |
| Shared chrome | `components/Theme.tsx` (`EmailThemeProvider`, `getEmailThemeClasses`, Geist font, dark-mode meta), `components/Logo.tsx`, `components/notificationStyles.ts` (the `nf-*` classes) |
| Rendering | jobs code: `render(SomeEmail({ ...props }))` from `@react-email/components` — a plain function call, no JSX in `@carbon/jobs` |
| Sending | the `carbon/send-email` event (`notifications/send-email.ts`, needs a `companyId`) or Resend directly for platform mail with no company (`scheduled/changelog-dispatch.ts`) — both honor `DISABLE_RESEND` |
| Previews | `src/email/previews/` — **one fixture per shipped email**, `pnpm --filter @carbon/documents email:previews` |

**Never build email HTML by string concatenation.** The changelog emails briefly did; that
is exactly how a template drifts from the card (different font, colors, no dark mode, no
`Logo`). Write a `.tsx` template in `@carbon/documents`, render it in the job.

## The card, top to bottom

Copy `MfaRequiredEmail.tsx` for a single-CTA email or `NotificationEmail.tsx` when there
are label/value details. Every piece below is load-bearing:

1. `<EmailThemeProvider preview={<Preview>…</Preview>} additionalHeadContent={<style>{notificationStyles}</style>}>` — the `Preview` is the inbox snippet; the `notificationStyles` are what make dark mode work.
2. `<Body className="my-auto mx-auto font-sans nf-body …themeClasses.body">`.
3. `<Container className="my-[40px] mx-auto p-[36px] max-w-[560px] rounded-[16px] nf-card …" style={{ borderRadius: 16, borderStyle: "solid", borderWidth: 1 }}>` — 560px, radius 16, 1px border.
4. `<Logo />` — the wordmark. Its `src` must be PUBLICLY reachable (the recipient's mail client fetches it): production/preview use `getAppUrl()`, anything else (a `crbn up` dev origin, localhost) falls back to `https://app.carbon.ms`.
5. **Eyebrow** — `text-[11px] uppercase … nf-eyebrow`, `letterSpacing: "0.14em"`, `mt-[40px] mb-[10px]`. Names the category: "New notification", "Security", "Changelog".
6. **Heading** — `text-[26px] font-medium text-center tracking-tight … mb-[32px]`. The action or title, one line.
7. **Greeting** — `Hi {recipientName ?? "there"},` at `text-[15px] leading-[26px]`. Only when the recipient is a Carbon user with a name; a bare email address (a changelog subscriber) gets no greeting.
8. **Callout** — `<Section className="nf-callout" style={{ backgroundColor: "#fafafa", borderColor: "#ececef", borderRadius: 12, borderStyle: "solid", borderWidth: 1, marginBottom: 28, padding: "18px 20px" }}>` with a `role="presentation"` table inside. For a notification about a RECORD, the message/reference lives here at `text-[15px] leading-[24px]`, with details as label/value rows at `text-[13px]` split by an `nf-divider`. An announcement with no record (`ChangelogEntryEmail`) skips the box and sets its description as centered prose under the heading instead.
9. **CTA** — one `<Button className="nf-cta" style={{ backgroundColor: "#0e0e0e", borderColor: "#0e0e0e", borderRadius: 10, …, padding: "13px 24px", fontSize: 14, fontWeight: 500 }}>`, centered, `mb-[24px]`. One button per email.
10. **Fallback link** — "Or open this link in your browser:" + the raw URL at `text-[13px] … break-all nf-fallback`. Always, for clients that strip buttons.
11. **Footer** (when the reader might not know why they got it) — `<Hr className="my-[32px] nf-divider …" />` then `text-[12px] leading-[18px] … nf-fallback`: why they received it + the action link ("Manage notification settings", "Unsubscribe").

## Rules that are not style

- **Dark mode is done by CLASS, not inline style.** Backgrounds go through `nf-*` classes so the `!important` media-query overrides in `notificationStyles` can flip them; an inline `background-color` beats them and renders a white card on a black Gmail. Text colors use `getEmailThemeClasses()` (`email-text`, `email-muted`, …). Off-black `#0e0e0e` and off-white `#fefefe`, never pure `#000`/`#fff` — pure values get auto-inverted by some clients.
- **No sample defaults on content props.** `NotificationEmail` deliberately gives `heading`/`message` no defaults: fabricated data must never reach a real recipient. Sample data lives in the preview fixture only. (Some older templates — `VerificationEmail` — still default their props; don't copy that, or their pre-card layout.)
- **Always send a `text` alternative** alongside `html` — the job builds it from the same content (see `entryEmailContent` in `packages/jobs/src/changelog/feed.ts`).
- **Broadcast mail carries a `List-Unsubscribe` header** and a footer link to where the reader turns it off. For the changelog newsletter that is the signed-in Account → Notifications page (only the user may change their preference), so there is no one-click `List-Unsubscribe-Post` and the email renders once per entry, not per recipient.
- **Links in customer-authored text are not links** unless they pass `renderInlineLinks` against the ERP origin (`NotificationEmail` `details`) — an `https://` in a body someone typed stays literal text.
- **Add the preview fixture in the same change** (`previews/<Name>.tsx`, props filled with obviously-sample values like "Acme Manufacturing" / "John Doe") — it is the only way anyone sees the email before a customer does.

## Checklist for a new email

- [ ] `packages/documents/src/email/<Name>Email.tsx`, copied from `MfaRequiredEmail.tsx` or `NotificationEmail.tsx`, all eleven pieces present
- [ ] Exported from `src/email/index.ts`
- [ ] `previews/<Name>Email.tsx` fixture
- [ ] Job renders with `render(<Name>Email({...}))` and sends `html` + `text` (+ unsubscribe headers if broadcast)
- [ ] `pnpm --filter @carbon/documents typecheck` and `email:previews` checked in light AND dark
