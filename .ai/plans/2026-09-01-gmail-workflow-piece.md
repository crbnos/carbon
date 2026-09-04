# Gmail as a workflow integration piece — implementation plan

**Spec / source:** `.ai/specs/2026-09-01-gmail-workflow-piece.md`
**Research:** `.ai/research/2026-09-01-gmail-workflow-piece.md`
**Rule:** `.claude/rules/workflow-integrations.md` ("Adding a piece" checklist — followed verbatim; nothing generic changes)
**Branch:** `feat/active-pieces-integration`

Package names (for `--filter`): `@carbon/jobs`, `@carbon/ee`, `@carbon/workflows`, `erp` (apps/erp).
Whole-repo typecheck OOMs — always scope it. `@carbon/jobs` typecheck is `tsc --noEmit`; `@carbon/ee`
and `erp` use `tsgo --noEmit` (both via `pnpm --filter <pkg> typecheck`).

## Progress

- [x] Task 1: Pin `@activepieces/piece-gmail@0.13.0` in `@carbon/jobs`
- [x] Task 2: The `gmail` allowlist row
- [x] Task 3: Registry, consent and pinned-value tests for the row
- [x] Task 4: Catalog test for the emitted Gmail step
- [x] Task 5: Gmail settings card + registration + uninstall hook
- [x] Task 6: Regenerate the workflow catalog + Lingui catalogs
- [x] Task 7: Docs: rule, AGENTS, `.env.example`, spec status
- [x] Task 8: End-to-end verification + run log
- [x] Task 9 (added after browser test): `integration` row migration + callback error logging + rule checklist fix

## Dependencies

```
1 → 2 → 3, 4, 6
5 independent of 2–4 (needs only Task 1's package for nothing; it references the piece by name)
6 → 7 → 8
```

Tasks 3, 4 and 5 may run in parallel once Task 2 is done. Task 6 must follow 2 (the generator
reads the allowlist). Task 8 last.

---

## Task 1: Pin `@activepieces/piece-gmail@0.13.0` in `@carbon/jobs`

**Depends on:** none
**Files:**
- Modify: `packages/jobs/package.json` — add `"@activepieces/piece-gmail": "0.13.0"` to `dependencies`, alphabetically before `@activepieces/piece-google-calendar`
- Modify: `pnpm-lock.yaml` (by pnpm)

**Steps:**
1. `pnpm --filter @carbon/jobs add @activepieces/piece-gmail@0.13.0 --save-exact`
2. Confirm the dependency line reads exactly `"@activepieces/piece-gmail": "0.13.0"` (no `^`). If pnpm wrote a range, edit it to the bare version and run `pnpm install`.

**Verify:**
```bash
grep -n '"@activepieces/piece-gmail"' packages/jobs/package.json
# Expected: one line, version "0.13.0" with no ^ or ~
node -e 'const m=require("./packages/jobs/node_modules/@activepieces/piece-gmail");console.log(Object.keys(m.gmail.actions()).length)'
# Expected: 26
```

**Out of scope:** any other dependency; the piece's own transitive versions.

---

## Task 2: The `gmail` allowlist row

**Depends on:** 1
**Files:**
- Modify: `packages/jobs/src/workflows/integrations/allowlist.ts` — add a `gmail` entry to `PIECE_ALLOWLIST` after the `slack` entry
- Copy from (precedent): the `"google-calendar"` entry in the same file (same OAuth app, same `accountLabel`, same `metadata`)

**Steps:**
1. Append this entry to `PIECE_ALLOWLIST`, after `slack`:

```ts
  // Same Google OAuth app as Google Calendar; its own card, consent and connections.
  gmail: {
    package: "@activepieces/piece-gmail",
    version: "0.13.0",
    label: "Gmail",
    actions: ["gmail_send_email"],
    oauth: {
      clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
      clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
      redirectUrlEnv: "GOOGLE_OAUTH_REDIRECT_URL",
      // SEND-ONLY, deliberately. The piece also asks for gmail.readonly and
      // gmail.compose, which Google classes as RESTRICTED: an app holding them must
      // pass an annual third-party CASA security assessment before anyone outside
      // its test users can consent. gmail.send is merely "sensitive" — the same
      // verification tier the Calendar scopes already need. Adding a read or reply
      // action is therefore a compliance decision, not a one-line edit.
      scope: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"]
    },
    accountLabel: {
      url: "https://www.googleapis.com/oauth2/v2/userinfo",
      field: "email"
    },
    metadata: { scopes: "scope" },
    props: {
      gmail_send_email: {
        // An array of {data,name} FILE objects; Carbon would send list<string>.
        // Deferred with the rest of attachments (needs a file value type).
        attachments: { omit: true },
        // Resolves the thread through messages.list, which needs gmail.readonly.
        in_reply_to: { omit: true },
        // Required-with-default would land it under Advanced, where switching it
        // on calls drafts.create → gmail.compose → 403. Pinned off and out.
        draft: { omit: true, value: false }
      }
    }
  }
```

2. Do not touch the `google-calendar` or `slack` entries.

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck
# Expected: no errors
pnpm --filter @carbon/jobs test -- src/workflows/integrations/registry.test.ts
# Expected: all existing tests pass (the row is loadable; Task 3 adds assertions)
```

**Out of scope:** `visibility.ts`, `properties.ts`, `catalog.ts`, `oauth.ts` — no generic change is needed; if the generator or any of these refuses the row, STOP and report rather than editing them.

---

## Task 3: Registry, consent and pinned-value tests for the row

**Depends on:** 2
**Files:**
- Modify: `packages/jobs/src/workflows/integrations/registry.test.ts` — add a `describe("gmail")` block after `describe("slack")`
- Modify: `packages/jobs/src/workflows/integrations/oauth.test.ts` — add one case to `describe("buildConsentUrl")` and one to `describe("requiredScopesFor")`
- Modify: `packages/jobs/src/workflows/integrations/visibility.test.ts` — add one case to `describe("pinnedValues")`
- Copy from (precedent): the `slack` cases in each of those files

**Steps:**
1. `registry.test.ts` — after the `describe("slack", …)` block:

```ts
describe("gmail", () => {
  it("loads the piece", async () => {
    const piece = await loadPiece("gmail");
    expect(Object.keys(piece.actions())).toContain("gmail_send_email");
  });

  it("exposes exactly the one allowlisted action", async () => {
    const actions = await getPieceActions("gmail");
    expect(Object.keys(actions)).toEqual(["gmail_send_email"]);
  });

  it("refuses the read and reply actions the piece has but the allowlist does not", async () => {
    await expect(getPieceAction("gmail", "gmail_search_email")).rejects.toThrow();
    await expect(getPieceAction("gmail", "gmail_reply_to_thread")).rejects.toThrow();
    await expect(getPieceAction("gmail", "send_email")).rejects.toThrow();
  });

  // The piece offers OAuth2 and a service-account CustomAuth; only the former is ours.
  it("finds the OAuth2 auth, whose scope list includes restricted scopes we do not request", async () => {
    const auth = await getPieceOAuth2Auth("gmail");
    expect(auth.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(auth.scope).toContain("https://www.googleapis.com/auth/gmail.readonly");
  });
});
```

2. `oauth.test.ts` — inside `describe("buildConsentUrl")`, after the Slack sixteen-scopes case:

```ts
  it("asks Google for send-only Gmail scopes, offline, with forced consent", async () => {
    const url = new URL(
      buildConsentUrl({
        entry: PIECE_ALLOWLIST.gmail!,
        auth: await getPieceOAuth2Auth("gmail"),
        app,
        state: "s"
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/auth");
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.send email"
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
```

   and inside `describe("requiredScopesFor")`:

```ts
  it("is send-only for gmail, never the piece's restricted scopes", async () => {
    const scopes = await requiredScopesFor("gmail");
    expect(scopes).toEqual(["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"]);
  });
```

   If `requiredScopesFor` is not already imported in that file, add it to the existing import from `./oauth`.

3. `visibility.test.ts` — inside `describe("pinnedValues")`, after "reads the real allowlist entry":

```ts
  it("pins gmail's draft flag off even though the prop is omitted from the form", () => {
    expect(pinnedValues("gmail", "gmail_send_email")).toEqual({ draft: false });
  });
```

   If `pinnedValues` for an `omit` override with a `value` does NOT include that value, STOP and report — the spec relies on `omit + value` behaving as Slack's `sendAsBot` does.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- src/workflows/integrations/registry.test.ts src/workflows/integrations/oauth.test.ts src/workflows/integrations/visibility.test.ts
# Expected: all pass, including the 7 new cases
```

**Out of scope:** `connections.test.ts` (ee) — nothing there is piece-specific.

---

## Task 4: Catalog test for the emitted Gmail step

**Depends on:** 2
**Files:**
- Modify: `packages/jobs/src/workflows/integrations/catalog.test.ts` — add a `describe("buildPieceActionDeclarations (gmail)")` block
- Copy from (precedent): `describe("buildPieceActionDeclarations (slack)")` in the same file

**Steps:**
1. Append:

```ts
describe("buildPieceActionDeclarations (gmail)", () => {
  it("emits the one send step with the send-only prop set", async () => {
    const all = await buildPieceActionDeclarations();
    const ids = Object.keys(all).filter((id) => id.startsWith("integration.gmail."));
    expect(ids).toEqual(["integration.gmail.gmail_send_email"]);

    const send = all["integration.gmail.gmail_send_email"]!;
    expect(Object.keys(send.inputs).sort()).toEqual(
      [
        "connectionId",
        "receiver",
        "cc",
        "bcc",
        "subject",
        "body",
        "reply_to",
        "sender_name",
        "from"
      ].sort()
    );
    // Required with a vendor default: hidden, still reachable, sent as plain_text.
    expect(Object.keys(send.advancedInputs ?? {})).toEqual(["body_type"]);
    for (const gone of ["attachments", "in_reply_to", "draft"]) {
      expect(send.inputs).not.toHaveProperty(gone);
      expect(send.advancedInputs ?? {}).not.toHaveProperty(gone);
    }
    expect(send.inputs.receiver!.type).toEqual({
      kind: "list",
      of: { kind: "primitive", of: "string" }
    });
    expect(send.outputs).toHaveProperty("count");
    expect(send.outputs).toHaveProperty("result");
  });
});
```

2. If the real emitted input set differs from the list above (for example a prop the generic visibility rules hide that the spec expected shown), STOP and report the actual list — do not edit the expectation to match without checking the spec's Design Decision #6/#7.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- src/workflows/integrations/catalog.test.ts src/workflows/integrations/properties.test.ts src/workflows/integrations/outputs.test.ts
# Expected: all pass
```

**Out of scope:** the generated catalog files (Task 6).

---

## Task 5: Gmail settings card + registration + uninstall hook

**Depends on:** none (may run in parallel with 2–4)
**Files:**
- Create: `packages/ee/src/gmail/config.tsx`
- Modify: `packages/ee/src/index.ts` — import, add to `integrations` array, export `Gmail` and `GmailLogo`
- Modify: `packages/ee/src/hooks.server.ts` — one `gmail` entry
- Copy from (precedent): `packages/ee/src/google-calendar/config.tsx` (card), `packages/ee/src/hooks.server.ts` `"google-calendar"` entry (hook)

**Steps:**
1. Create `packages/ee/src/gmail/config.tsx`:

```tsx
import { GOOGLE_OAUTH_CLIENT_ID } from "@carbon/auth";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { startIntegrationConnect } from "../integrations/connect";

/** The card's id IS the Activepieces piece name — see google-calendar/config.tsx. */
const PIECE = "gmail";

/**
 * Gmail, as an ordinary integration card, on the same Google OAuth app as Google
 * Calendar. Each connected account sends as itself. The consent asks ONLY for
 * permission to send (`gmail.send`) — never to read the mailbox — which is what
 * keeps the app out of Google's restricted-scope tier.
 */
export const Gmail = defineIntegration({
  name: "Gmail",
  id: PIECE,
  category: "Email",
  // Unset OAuth credentials render the card "Coming soon" rather than offering an
  // Install that could only fail.
  active: !!GOOGLE_OAUTH_CLIENT_ID,
  logo: Logo,
  shortDescription:
    "Send email from your workflows using a connected Google account.",
  description:
    "Connect a Google account so your workflows can send email as that account — purchase orders to suppliers, quotes and updates to customers — with the message in its Sent folder and replies going to a real inbox. Carbon asks only for permission to send, never to read the mailbox. Connect more than one account if different workflows should send as different people. Google's own daily sending limits apply to each account.",
  images: [],
  settings: [],
  schema: z.object({}),
  onClientInstall: () =>
    startIntegrationConnect(`/api/integrations/connections/${PIECE}/connect`)
});

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 36"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Gmail"
      {...props}
    >
      <path d="M3.27 36h7.64V17.45L0 9.27v23.46A3.27 3.27 0 0 0 3.27 36z" fill="#4285f4" />
      <path d="M37.09 36h7.64A3.27 3.27 0 0 0 48 32.73V9.27l-10.91 8.18V36z" fill="#34a853" />
      <path d="M37.09 3.27v14.18L48 9.27V4.91c0-4.05-4.62-6.36-7.85-3.93l-3.06 2.29z" fill="#fbbc04" />
      <path d="M10.91 17.45V3.27L24 13.09 37.09 3.27v14.18L24 27.27 10.91 17.45z" fill="#ea4335" />
      <path d="M0 4.91v4.36l10.91 8.18V3.27L7.85.98C4.62-1.45 0 .86 0 4.91z" fill="#c5221f" />
    </svg>
  );
}
```

2. `packages/ee/src/index.ts`:
   - Add `import { Gmail } from "./gmail/config";` after the `ExchangeRates` import.
   - In the `integrations` array insert `Gmail,` between `ExchangeRates,` and `GoogleCalendar,`.
   - After the `GoogleCalendar` re-export block add:
     ```ts
     export { Gmail, Logo as GmailLogo } from "./gmail/config";
     ```
3. `packages/ee/src/hooks.server.ts` — directly after the `"google-calendar": { … },` entry:

```ts
  gmail: {
    onUninstall: (companyId) =>
      revokeConnectionsForPiece(getCarbonServiceRole(), "gmail", companyId)
  },
```

**Verify:**
```bash
pnpm --filter @carbon/ee typecheck
# Expected: no errors
pnpm --filter erp typecheck
# Expected: no errors (IntegrationID union grows; nothing narrows on it)
pnpm exec biome check packages/ee/src/gmail/config.tsx packages/ee/src/index.ts packages/ee/src/hooks.server.ts
# Expected: no diagnostics
```

**Out of scope:** `ConnectionsTab.tsx`, `IntegrationForm.tsx`, `getIntegrationHealth` — all key off `PIECE_ALLOWLIST` by name. Any `if (id === "gmail")` anywhere is a bug.

---

## Task 6: Regenerate the workflow catalog + Lingui catalogs

**Depends on:** 2, 3, 4 (green tests first, so a generator refusal is a real one)
**Files:**
- Modify (generated): `packages/workflows/src/catalog/actions.generated.ts`, `packages/workflows/src/catalog/labels.generated.ts` (and `help.generated.ts` if the generator writes the vendor prop descriptions there)
- Modify (generated): `packages/locale/locales/*/erp.po`

**Steps:**
1. `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog`
   If the generator refuses a prop, STOP and report which — the spec's override set is meant to be complete.
2. `pnpm run lingui:extract && pnpm run lingui:clean` (never commit `.po` files without the clean step — see `.ai/lessons.md`).
3. Inspect that `integration.gmail` and `integration.gmail.gmail_send_email` labels exist in `labels.generated.ts`, and that `attachments`, `in_reply_to`, `draft` do not appear inside the `integration.gmail.gmail_send_email` block of `actions.generated.ts`.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: exit 0, no staleness report
grep -o '"integration\.gmail\.[a-z_-]*"' packages/workflows/src/catalog/actions.generated.ts | sort -u
# Expected: exactly "integration.gmail.gmail_send_email"
grep -c 'integration.gmail' packages/workflows/src/catalog/labels.generated.ts
# Expected: a number > 0
pnpm --filter @carbon/workflows test
# Expected: all pass
git diff --stat -- packages/locale | tail -1
# Expected: 26 .po files changed with the new strings only (no "#:" origin lines)
```

**Out of scope:** hand-editing any generated file; running `pnpm run translate` (LLM translation — leave to the usual translation pass).

---

## Task 7: Docs: rule, AGENTS, `.env.example`, spec status

**Depends on:** 6
**Files:**
- Modify: `.claude/rules/workflow-integrations.md` — line "the allowlist has two (Google Calendar, Slack)." → "the allowlist has three (Google Calendar, Slack, Gmail)."; under "### Scope drift" add one paragraph (below)
- Modify: `packages/ee/AGENTS.md` — the "Workflow integration connections" bullet: extend the config list "(`google-calendar/config.tsx`, `slack/config.tsx`; `id` === the piece name)" → "(`google-calendar/config.tsx`, `gmail/config.tsx`, `slack/config.tsx`; `id` === the piece name)"
- Modify: `packages/jobs/AGENTS.md` — wherever the allowlist is described, mention `gmail` (send-only) beside the other two; if the file does not describe the allowlist, leave it untouched
- Modify: `.env.example` — line 95 "(Google Calendar)." → "(Google Calendar, Gmail)."
- Modify: `.ai/specs/2026-09-01-gmail-workflow-piece.md` — `Status: draft — awaiting review` → `Status: implemented (2026-09-01)`; append a changelog line

**Steps:**
1. Rule paragraph to add at the end of "### Scope drift — "Reconnect needed"":

   > Gmail is deliberately **send-only** (`gmail.send` + `email`, an allowlist `oauth.scope`
   > override). The piece's own list adds `gmail.readonly` and `gmail.compose`, which Google
   > classes as *restricted*: an app holding them must pass an annual third-party CASA security
   > assessment before non-test users can consent. So the row omits `in_reply_to` (needs
   > `messages.list`), pins `draft` off (needs `drafts.create`) and omits `attachments` (file
   > objects — no Carbon input type yet). Widening to read/reply is a compliance decision first.

2. Apply the other edits verbatim.

**Verify:**
```bash
grep -n "three (Google Calendar, Slack, Gmail)" .claude/rules/workflow-integrations.md
# Expected: 1 match
grep -n "gmail/config.tsx" packages/ee/AGENTS.md
# Expected: 1 match
grep -n "Google Calendar, Gmail" .env.example
# Expected: 1 match
grep -n "Status: implemented" .ai/specs/2026-09-01-gmail-workflow-piece.md
# Expected: 1 match
```

**Out of scope:** rewriting any other section of the rule; `docs/`.

---

## Task 8: End-to-end verification + run log

**Depends on:** 7
**Files:**
- Create: `.ai/runs/2026-09-01-gmail-workflow-piece.md` — the run log (precedent: `.ai/runs/2026-09-01-slack-workflow-piece.md`)

**Steps:**
1. Run every automated gate:
   ```bash
   pnpm --filter @carbon/jobs test
   pnpm --filter @carbon/ee test
   pnpm --filter @carbon/workflows test
   pnpm --filter @carbon/jobs typecheck && pnpm --filter @carbon/ee typecheck && pnpm --filter erp typecheck
   pnpm run check:workflow-catalog
   pnpm exec biome check packages/jobs/src/workflows/integrations packages/ee/src/gmail packages/ee/src/index.ts packages/ee/src/hooks.server.ts
   ```
2. Walk the spec's Acceptance Criteria 1–10. Criteria 1, 4 (the `metadata` invariant via `connections.test.ts`), 6 (form shape via `catalog.test.ts`), 8 (via `revokeConnectionsForPiece` scoping by piece name) and 10 are provable here. Criteria 2, 3, 5, 7, 9 need a browser and a Google test user on the consent screen with `gmail.send` added — record them as BROWSER-PENDING with the exact click path, as the Slack run log did.
3. Write the run log: one line per gate with its result, one line per criterion with PASS / BROWSER-PENDING and how it was checked, and the Google Cloud console steps (add scope, add test user, submit sensitive-scope verification) as the operator's to-do.

**Verify:**
```bash
test -f .ai/runs/2026-09-01-gmail-workflow-piece.md && grep -c "PASS\|BROWSER-PENDING" .ai/runs/2026-09-01-gmail-workflow-piece.md
# Expected: file exists; count ≥ 10
git status --short
# Expected: only the files named in Tasks 1–8 (plus generated catalog/.po files)
```

**Out of scope:** committing — the user commits (never auto-commit).
