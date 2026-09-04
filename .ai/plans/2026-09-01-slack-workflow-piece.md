# Slack as a workflow integration piece — implementation plan

**Spec / source:** `.ai/specs/2026-09-01-slack-workflow-piece.md`
**Research:** `.ai/research/2026-09-01-slack-workflow-piece.md`
**Rule:** `.claude/rules/workflow-integrations.md` ("Adding a piece" checklist; this plan deviates
only where the spec says so: same card as the Assistant, allowlist `oauth.authUrl`/`scope`
overrides, `omit` prop override, mark-installed that preserves metadata).
**Branch:** `feat/active-pieces-integration`

Package names (for `--filter`): `@carbon/jobs`, `@carbon/ee`, `@carbon/env`, `@carbon/workflows`,
`erp` (apps/erp). Whole-repo typecheck OOMs — always scope it.

## Progress

- [x] Task 1: Pin `@activepieces/piece-slack@0.17.9` in `@carbon/jobs`
- [x] Task 2: Allowlist types + the `slack` row; registry tests
- [x] Task 3: `omit` visibility (+ `MARKDOWN` auto-omit) and pinned values
- [x] Task 4: Generator consults visibility before mapping; `toPropsValue` skips `MARKDOWN`; catalog test
- [x] Task 5: `buildConsentUrl` with allowlist overrides; connect route uses it
- [x] Task 6: `markIntegrationInstalled` preserves metadata; callback uses it
- [x] Task 7: `getSlackAuth` null-guard; `readTokenResponse` names Slack's `error`
- [x] Task 8: `hooks.server.ts` `slack` entry + Slack card copy
- [x] Task 9: `SLACK_CONNECTIONS_REDIRECT_URL` env plumbing — **reverted later the same day**; `SLACK_OAUTH_REDIRECT_URL` kept (see the single-source plan, Task 11)
- [x] Task 10: Builder "Connect" deep-links to the Accounts tab
- [x] Task 11: Regenerate the workflow catalog + Lingui catalogs
- [x] Task 12: Sync the rule doc and spec status
- [x] Task 13: End-to-end verification + run log

## Dependencies

```
1 → 2 → 4 → 11
3 → 4
2 → 5
6, 7, 8, 9, 10 independent of each other; 8 and 9 need 2 only for the names they reference
11 → 12 → 13
```

Tasks 3, 6, 7, 9, 10 may run in parallel with Task 2. Task 11 must run after 2, 3, 4 (it reads
the allowlist through the generator).

---

## Task 1: Pin `@activepieces/piece-slack@0.17.9` in `@carbon/jobs`

**Depends on:** none
**Files:**
- Modify: `packages/jobs/package.json` — add `"@activepieces/piece-slack": "0.17.9"` (exact, no `^`)
- Modify: `pnpm-lock.yaml` — by pnpm

**Steps:**
1. `pnpm --filter @carbon/jobs add @activepieces/piece-slack@0.17.9 --save-exact`
2. Confirm the entry sits beside `"@activepieces/piece-google-calendar": "0.10.3"` with no range.
3. The bundle requires only Node built-ins (verified in research); no framework dependency is needed.
   If pnpm reports a peer-dependency warning for `@activepieces/pieces-framework`, STOP and report — do
   not add the framework.

**Verify:**
```bash
grep -n '"@activepieces/piece-slack": "0.17.9"' packages/jobs/package.json
# Expected: one line
cd packages/jobs && node -e 'import("@activepieces/piece-slack").then(m => console.log(Object.keys(m.slack.actions()).length))'
# Expected: a number ≥ 70
```

**Out of scope:** any other dependency change; no `patches/` entry.

---

## Task 2: Allowlist types + the `slack` row; registry tests

**Depends on:** 1
**Files:**
- Modify: `packages/jobs/src/workflows/integrations/allowlist.ts`
- Modify: `packages/jobs/src/workflows/integrations/registry.test.ts`

**Steps:**
1. Extend the types (keep existing fields and their comments):
   ```ts
   export interface AllowlistPropOverride {
     hidden?: boolean;
     /** Drop the prop from the step entirely — neither the form nor Advanced offers it.
      * For props whose non-default value needs a host capability Carbon refuses (send as
      * user, mention the origin flow) or a type Carbon cannot render. A `value` is still
      * sent at run time; a required prop needs one. */
     omit?: boolean;
     value?: unknown;
   }
   export interface AllowlistEntry {
     // ...existing...
     oauth: {
       clientIdEnv: string;
       clientSecretEnv: string;
       redirectUrlEnv: string;
       /** Consent endpoint to use instead of the piece's `authUrl` — for a piece that bakes
        * extra requests (Slack's `user_scope=`) into its URL. */
       authUrl?: string;
       /** Scopes to request instead of the piece's full list. Must cover every allowlisted
        * action and the `options()` its dropdowns call. */
       scope?: readonly string[];
     };
     // ...existing...
   }
   ```
2. Add the row after `"google-calendar"` exactly as written in spec §1 (`package`, `version: "0.17.9"`,
   `label: "Slack"`, the four actions, `oauth` with `clientIdEnv: "SLACK_CLIENT_ID"`,
   `clientSecretEnv: "SLACK_CLIENT_SECRET"`, `redirectUrlEnv: "SLACK_CONNECTIONS_REDIRECT_URL"`,
   `authUrl: "https://slack.com/oauth/v2/authorize"`, the 10-scope list with the per-line comments,
   `accountLabel: { url: "https://slack.com/api/auth.test", field: "team" }`, and the `props`
   block: `send_channel_message` → `sendAsBot: { omit: true, value: true }`,
   `mentionOriginFlow: { omit: true }`, `file: { omit: true }`, `blocks: { omit: true }`;
   `send_direct_message` → `mentionOriginFlow: { omit: true }`, `blocks: { omit: true }`).
   Add a one-line comment above the row: the card id `slack` is the Carbon Assistant's, shared on
   purpose (spec Q1).
3. In `registry.test.ts` add, mirroring the existing google-calendar cases:
   - `loadPiece("slack")` resolves a piece whose `actions()` includes `send_channel_message`;
   - `getPieceActions("slack")` keys equal `[...PIECE_ALLOWLIST.slack!.actions].sort()`;
   - `getPieceAction("slack", "custom_api_call")` rejects;
   - `getPieceOAuth2Auth("slack")` resolves with `tokenUrl === "https://slack.com/api/oauth.v2.access"`
     and an `authUrl` that `includes("user_scope=")` (documents WHY the override exists).

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/workflows/integrations/registry.test.ts
# Expected: all tests pass, including the 4 new slack cases
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no errors
```

**Out of scope:** `oauth.ts` `resolveOAuthApp` (unchanged — it reads the three env names only).

---

## Task 3: `omit` visibility (+ `MARKDOWN` auto-omit) and pinned values

**Depends on:** none (types from Task 2; if Task 2 has not landed, add `omit?: boolean` to
`AllowlistPropOverride` here — the two edits are identical)
**Files:**
- Modify: `packages/jobs/src/workflows/integrations/visibility.ts`
- Modify: `packages/jobs/src/workflows/integrations/visibility.test.ts`

**Steps:**
1. Widen the type:
   ```ts
   export type Visibility =
     | { show: true }
     | { show: false; omit?: false; value?: unknown }
     | { show: false; omit: true; value?: unknown };
   ```
2. In `visibilityOf`, BEFORE the existing `override?.hidden` check:
   ```ts
   // Display-only: Activepieces `Property.MarkDown` renders text and never collects a
   // value, so there is no input to offer.
   if (property.type === "MARKDOWN") return { show: false, omit: true };
   if (override?.omit === true) {
     return override.value === undefined
       ? { show: false, omit: true }
       : { show: false, omit: true, value: override.value };
   }
   ```
3. `assertHiddenPropIsSatisfied` needs no change (an omitted required prop with no value already
   throws). Update its message to `is required but hidden or omitted with no value to send.`
4. `pinnedValues` needs no change — it already pins any `!show` visibility with a value.
5. Tests (same `prop()` helper style):
   - `omit: true` → `{ show: false, omit: true }`; with `value: true` → carries the value;
   - `type: "MARKDOWN"` with no override → `{ show: false, omit: true }`;
   - `assertHiddenPropIsSatisfied` throws for `required: true` + `{ omit: true }` and passes with
     `{ omit: true, value: true }`;
   - `pinnedValues` returns `{ sendAsBot: true }` for a required-with-default prop overridden
     `{ omit: true, value: true }` (build the override map via a stubbed `PIECE_ALLOWLIST` the way
     the existing `pinnedValues` tests do — read them first and copy the mechanism).

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/workflows/integrations/visibility.test.ts
# Expected: all pass, including the new omit / MARKDOWN cases
```

**Out of scope:** `catalog.ts` (Task 4).

---

## Task 4: Generator consults visibility before mapping; `toPropsValue` skips `MARKDOWN`; catalog test

**Depends on:** 2, 3
**Files:**
- Modify: `packages/jobs/src/workflows/integrations/catalog.ts` — reorder the prop loop
- Modify: `packages/jobs/src/workflows/integrations/properties.ts` — `toPropsValue`
- Modify: `packages/jobs/src/workflows/integrations/properties.test.ts`
- Create: `packages/jobs/src/workflows/integrations/catalog.test.ts`

**Steps:**
1. In `catalog.ts`'s `for (const [propName, property] of Object.entries(action.props))` loop, move the
   `visibilityOf(...)` + `assertHiddenPropIsSatisfied(...)` calls to the TOP of the loop body, then:
   ```ts
   // Omitted props are not part of the step: nothing to render, so nothing to map — an
   // unmappable type is only ever an error for a prop a person would see.
   if (!visibility.show && visibility.omit === true) continue;
   const mapped = toValueType(pieceName, actionName, propName, property);
   ```
   Keep the rest (shown → `inputs`, hidden → `advancedInputs`) unchanged.
2. In `toPropsValue`, skip `MARKDOWN` props at the top of the loop:
   ```ts
   if (props[name]?.type === "MARKDOWN") continue; // display-only, never a value
   ```
   (Pins for omitted props still flow through the existing `pinned[name]` branch.)
3. `properties.test.ts`: add a `toPropsValue` case — props `{ info: MARKDOWN, text: LONG_TEXT }`,
   inputs `{ info: "x", text: "hi" }` → `{ text: "hi" }`.
4. `catalog.test.ts` (new; the registry tests already load real pieces, so this one does too):
   ```ts
   import { describe, expect, it } from "vitest";
   import { buildPieceActionDeclarations } from "./catalog";
   describe("buildPieceActionDeclarations (slack)", () => {
     it("emits the four allowlisted slack steps with omitted props absent", async () => {
       const all = await buildPieceActionDeclarations();
       const ids = Object.keys(all).filter((id) => id.startsWith("integration.slack."));
       expect(ids.sort()).toEqual([
         "integration.slack.send_channel_message",
         "integration.slack.send_direct_message",
         "integration.slack.slack-create-channel",
         "integration.slack.slack-find-user-by-email"
       ]);
       const send = all["integration.slack.send_channel_message"]!;
       expect(Object.keys(send.inputs)).toEqual([
         "connectionId", "channel", "text", "threadTs", "username",
         "profilePicture", "iconEmoji", "replyBroadcast", "unfurlLinks"
       ]);
       expect(send.advancedInputs).toBeUndefined();
       for (const gone of ["info", "file", "blocks", "sendAsBot", "mentionOriginFlow"]) {
         expect(send.inputs).not.toHaveProperty(gone);
       }
       expect(send.inputs.channel!.options?.provider).toBe("integration.property");
       expect(send.outputs).toHaveProperty("count");
       expect(send.outputs).toHaveProperty("result");
     });
     it("still refuses an unmappable prop that is merely hidden", async () => {
       // pinnedValues-style stub of PIECE_ALLOWLIST is heavier than needed here; assert the
       // rule at the unit that owns it instead:
       const { toValueType, UnmappablePropertyError } = await import("./properties");
       expect(() => toValueType("p", "a", "blocks", { type: "JSON", required: false })).toThrow(
         UnmappablePropertyError
       );
     });
   });
   ```
   If the actual input key ORDER differs from the list above (it follows the piece's own prop order),
   compare sorted arrays instead — do not reorder the generator.

5. **(Added during execution.)** The generator's `assertLabelIsSafe` refuses any label or
   description containing a backtick or `${` (it emits them inside `msg` template literals), and
   Slack's `threadTs` description contains both backticked examples. Vendor prose is not Carbon
   prose, so sanitise it where it enters: in `properties.ts` add
   `function vendorText(text: string): string` that replaces every backtick with `'` and every
   `${` with `$ {`, and apply it to `label` and `description` in `toValueType`. Test in
   `properties.test.ts`: a prop with `description: "use `ts` or ${x}"` maps to
   `"use 'ts' or $ {x}"`.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/workflows/integrations/
# Expected: every integrations test passes (registry, visibility, properties, catalog, outputs, project, oauth)
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no errors
```

**Out of scope:** `outputs.ts`, `project.ts`, the generated files (Task 11).

---

## Task 5: `buildConsentUrl` with allowlist overrides; connect route uses it

**Depends on:** 2
**Files:**
- Modify: `packages/jobs/src/workflows/integrations/oauth.ts` — add `buildConsentUrl`
- Modify: `packages/jobs/src/workflows/integrations/oauth.test.ts`
- Modify: `packages/jobs/src/workflows/integrations/index.ts` — export it (check the barrel's shape first)
- Modify: `apps/erp/app/routes/api+/integrations.connections.$piece.connect.ts` — call it

**Steps:**
1. In `oauth.ts`:
   ```ts
   /** The vendor consent URL. The piece supplies `authUrl` and `scope`; an allowlist row may
    * override either — Slack's piece bakes `user_scope=` into its URL and asks for 30 bot
    * scopes, and we want the bot scopes our four actions need and nothing else. */
   export function buildConsentUrl(args: {
     entry: Pick<AllowlistEntry, "oauth">;
     auth: Pick<OAuth2AuthDeclaration, "authUrl" | "scope">;
     app: Pick<PieceOAuthApp, "clientId" | "redirectUrl">;
     state: string;
   }): string {
     const url = new URL(args.entry.oauth.authUrl ?? args.auth.authUrl);
     url.searchParams.set("client_id", args.app.clientId);
     url.searchParams.set("redirect_uri", args.app.redirectUrl);
     url.searchParams.set("response_type", "code");
     url.searchParams.set("scope", (args.entry.oauth.scope ?? args.auth.scope).join(" "));
     // Without both of these Google returns no refresh token on a re-authorization.
     // Slack ignores them.
     url.searchParams.set("access_type", "offline");
     url.searchParams.set("prompt", "consent");
     url.searchParams.set("state", args.state);
     return url.toString();
   }
   ```
   Import `AllowlistEntry` from `./allowlist` and `OAuth2AuthDeclaration` from `./types`.
2. Replace the inline URL building in the connect route (from `const url = new URL(auth.authUrl)` to
   `return { url: url.toString() }`) with
   `return { url: buildConsentUrl({ entry, auth, app, state: signConnectionState({ companyId, pieceName, name, userId }) }) };`
   and import `buildConsentUrl` from `@carbon/jobs/integrations`.
3. `oauth.test.ts` — add:
   - piece defaults: entry with no overrides, auth `{ authUrl: "https://v.example/auth?x=1", scope: ["a","b"] }`
     → URL keeps `x=1`, `scope === "a b"`, has `client_id`, `redirect_uri`, `state`;
   - overrides: entry `{ oauth: { ..., authUrl: "https://slack.com/oauth/v2/authorize", scope: ["chat:write"] } }`
     with auth `authUrl` containing `?user_scope=search:read` → result has NO `user_scope` param and
     `scope === "chat:write"`;
   - the real row: `buildConsentUrl({ entry: PIECE_ALLOWLIST.slack!, auth: await getPieceOAuth2Auth("slack"), app: {clientId:"c", redirectUrl:"https://r"}, state:"s" })`
     → no `user_scope`, `scope` split by space has length 10 and includes `chat:write.public`.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/workflows/integrations/oauth.test.ts
# Expected: pass, including the 3 new cases
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** the callback route (Task 6); `resolveOAuthApp`.

---

## Task 6: `markIntegrationInstalled` preserves metadata; callback uses it

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — add `markIntegrationInstalled` next to `upsertCompanyIntegration`
- Modify: `apps/erp/app/routes/api+/integrations.connections.callback.ts` — replace the `upsertCompanyIntegration` call

**Steps:**
1. Add:
   ```ts
   /**
    * Flip an integration to installed WITHOUT touching what is already there. The piece
    * callback marks its card installed after a connection is saved; on a card another
    * flow also owns (Slack: the Carbon Assistant's bot install), an upsert with empty
    * metadata would wipe that flow's `team_id`, `channel_id` and webhook url.
    */
   export async function markIntegrationInstalled(
     client: SupabaseClient<Database>,
     args: { id: string; companyId: string; updatedBy: string }
   ): Promise<{ error: PostgrestError | null }> {
     const existing = await client
       .from("companyIntegration")
       .select("active")
       .eq("id", args.id)
       .eq("companyId", args.companyId)
       .maybeSingle();
     if (existing.error) return { error: existing.error };

     let error: PostgrestError | null = null;
     if (existing.data === null) {
       ({ error } = await client.from("companyIntegration").insert({
         id: args.id,
         companyId: args.companyId,
         active: true,
         metadata: {},
         updatedBy: args.updatedBy
       }));
     } else if (existing.data.active !== true) {
       ({ error } = await client
         .from("companyIntegration")
         .update({ active: true, updatedBy: args.updatedBy })
         .eq("id", args.id)
         .eq("companyId", args.companyId));
     }
     if (error === null) await clearCompanyIntegrationCache(args.companyId);
     return { error };
   }
   ```
   Match the file's existing imports for `PostgrestError` (check how `upsertCompanyIntegration`'s
   return type is written; if the file does not import `PostgrestError`, import it from
   `@supabase/supabase-js`). Read the row directly rather than via `getCompanyIntegration` — that
   helper is Redis-cached and filters `active === true`.
   If the `companyIntegration` insert requires columns beyond `id, companyId, active, metadata, updatedBy`
   (check `packages/database/src/types.ts` `companyIntegration.Insert`), add them with the same values
   `upsertCompanyIntegration` would produce; do not invent defaults — STOP and report if unclear.
2. In the callback replace the block starting `await upsertCompanyIntegration(client, {` with
   ```ts
   const installed = await markIntegrationInstalled(client, {
     id: state.pieceName,
     companyId,
     updatedBy: userId
   });
   if (installed.error) throw installed.error;
   ```
   Keep the explanatory comment above it, extended with one line: "never overwrite an existing row —
   the Slack card is also the Assistant's". Update the import (`markIntegrationInstalled` in place of
   `upsertCompanyIntegration`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
grep -n "upsertCompanyIntegration" apps/erp/app/routes/api+/integrations.connections.callback.ts
# Expected: no output
```

**Out of scope:** `upsertCompanyIntegration` itself (still used by the Assistant's own callback);
the Slack Assistant OAuth route.

---

## Task 7: `getSlackAuth` null-guard; `readTokenResponse` names Slack's `error`

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/slack/lib/service.ts` — `getSlackAuth`
- Modify: `packages/ee/src/integrations/connections.ts` — `readTokenResponse`
- Modify: `packages/ee/src/integrations/connections.test.ts`

**Steps:**
1. In `getSlackAuth`, after `resolveIntegrationSecrets(...)` and the existing `if (!metadata) return null;`:
   ```ts
   // The row can be "installed" by a workflow connection alone (the card is shared with
   // the Activepieces Slack piece); without a bot token the Assistant is not connected.
   if (typeof metadata.access_token !== "string" || metadata.access_token.length === 0) {
     return null;
   }
   ```
   Widen the cast to `{ access_token?: string; channel_id?: string }` so the guard type-checks, and keep
   the returned shape unchanged.
2. In `readTokenResponse` (connections.ts), extend the parsed shape with `error?: string` and change
   the throw to:
   ```ts
   if (typeof body.access_token !== "string") {
     // Slack rejects with HTTP 200 and `{ ok: false, error }`; name it for the server log.
     // The callback maps this message to a code — the browser never sees it.
     throw new Error(
       typeof body.error === "string"
         ? `The connection returned no access token (${body.error}).`
         : "The connection returned no access token."
     );
   }
   ```
   The callback's `message.includes("access token")` match still holds.
3. `connections.test.ts`: add a `resolveConnectionAuth` case where `fetch` resolves
   `{ ok: true, json: async () => ({ ok: false, error: "invalid_code" }) }` for a connection with
   `expiresAt: inMinutes(1)` and stored `rt-1`: it rejects with `ConnectionRevokedError`? — NO: a
   200 with no token is not a `ConnectionRejectedError`, so per the transient rule from commit
   `cd04bee95` it must **keep the row Active**, release the claim, and reject with a message
   containing `invalid_code`. Assert exactly that.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/integrations/connections.test.ts
# Expected: pass, including the new invalid_code case
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no errors
```

**Out of scope:** `send-slack.ts` (already returns `null` → env fallback when `access_token` is absent —
verified, unchanged); other Slack service functions.

---

## Task 8: `hooks.server.ts` `slack` entry + Slack card copy

**Depends on:** none (references the piece name only)
**Files:**
- Modify: `packages/ee/src/hooks.server.ts`
- Modify: `packages/ee/src/slack/config.tsx`
- Copy from (precedent): the `"google-calendar"` entry in `hooks.server.ts`; `packages/ee/src/google-calendar/config.tsx` for copy tone

**Steps:**
1. Add, keeping alphabetical position near `stripe-connect`/`rillet` if the object is ordered, else after
   `"google-calendar"`:
   ```ts
   // The Slack card is shared: the Carbon Assistant's bot install AND the workflow piece's
   // accounts. Health reads the accounts; Uninstall revokes them along with the Assistant.
   slack: {
     onHealthcheck: (companyId) => pieceConnectionsHealthy(companyId, "slack"),
     onUninstall: (companyId) =>
       revokeConnectionsForPiece(getCarbonServiceRole(), "slack", companyId)
   },
   ```
   If a `slack` key already exists (grep first), MERGE into it rather than duplicating.
2. In `config.tsx` change:
   - `shortDescription` → `"Use the Carbon Assistant in Slack, and let workflows post to your channels."`
   - `description` → `"Integrating Carbon with Slack lets you use the Carbon Assistant from your workspace and lets workflow steps send messages, find users and create channels. Connect one or more accounts under Accounts to choose which workspace a workflow acts as."`
   Plain strings, matching every other `defineIntegration` card (spec §6).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: no errors
grep -n "slack:" packages/ee/src/hooks.server.ts
# Expected: exactly one match
```

**Out of scope:** the Assistant's install/oauth/interactive routes; `packages/ee/src/index.ts`
(the Slack card is already registered).

---

## Task 9: `SLACK_CONNECTIONS_REDIRECT_URL` env plumbing

**Depends on:** none
**Files:**
- Modify: `packages/env/src/index.ts` — `ProcessEnv` declaration (next to `SLACK_OAUTH_REDIRECT_URL`, ~line 67) and an export after `SLACK_OAUTH_REDIRECT_URL` (~line 329)
- Modify: `.env.example` — after line 57 `SLACK_OAUTH_REDIRECT_URL=""`
- Modify: `.env` — set `SLACK_CONNECTIONS_REDIRECT_URL="https://erp.active-pieces-integration.dev/api/integrations/connections/callback"` (same host as `GOOGLE_OAUTH_REDIRECT_URL`; local only, never committed — `.env` is gitignored, confirm with `git check-ignore .env`)
- Modify: `sst.config.ts` — after line 86
- Modify: `ci/src/deploy.ts` — interface (~line 68), destructure (~line 151), env mapping (~line 309)

**Steps:**
1. `packages/env/src/index.ts`:
   ```ts
   // ProcessEnv:
   SLACK_CONNECTIONS_REDIRECT_URL: string;
   // export:
   /** Callback for workflow-piece Slack accounts (`/api/integrations/connections/callback`);
    * distinct from `SLACK_OAUTH_REDIRECT_URL`, which is the Assistant's own route. */
   export const SLACK_CONNECTIONS_REDIRECT_URL = getEnv("SLACK_CONNECTIONS_REDIRECT_URL", {
     isRequired: false
   });
   ```
   Do NOT add it to `getBrowserEnv()` or `Window.env` — server-only (spec: card gating unchanged).
2. `.env.example`: `SLACK_CONNECTIONS_REDIRECT_URL=""` with a trailing comment `# workflow piece accounts callback`.
3. `sst.config.ts`: `SLACK_CONNECTIONS_REDIRECT_URL: process.env.SLACK_CONNECTIONS_REDIRECT_URL,`.
4. `ci/src/deploy.ts`: `slack_connections_redirect_url: string | null;` in the interface, add to the
   destructure list, and `SLACK_CONNECTIONS_REDIRECT_URL: slack_connections_redirect_url ?? undefined,`
   in the env map — each immediately after its `slack_oauth_redirect_url` sibling.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/env
# Expected: no errors
grep -rn "SLACK_CONNECTIONS_REDIRECT_URL" packages/env/src/index.ts .env.example sst.config.ts ci/src/deploy.ts | wc -l
# Expected: 5 (2 in env index, 1 each elsewhere)
git status --short .env
# Expected: no output (ignored)
```

**Out of scope:** `apps/erp/app/root.tsx` loader env (server-only var — the window.env lesson does not apply).

---

## Task 10: Builder "Connect" deep-links to the Accounts tab

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx` (~line 226)

**Steps:**
1. Change `to={path.to.integration(piece)}` to `to={`${path.to.integration(piece)}?tab=connections`}`.
2. Add a one-line comment above the `<Link>`: on a card shared with another flow (Slack: the
   Assistant) the Install button is not the piece's consent — land on Accounts → Add account.
   `integrations.$id.tsx` already honours `?tab=` (`tabParam`, ~line 1782).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
grep -n 'tab=connections' apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx
# Expected: one match
```

**Out of scope:** `path.ts` (no new helper), `ConnectionsTab.tsx`.

---

## Task 11: Regenerate the workflow catalog + Lingui catalogs

**Depends on:** 2, 3, 4
**Files:**
- Modify (generated): `packages/workflows/src/catalog/actions.generated.ts`, `packages/workflows/src/catalog/labels.generated.ts`
- Modify (generated): `packages/locale/locales/*/erp.po` (and compiled outputs, whatever `lingui:extract` touches)

**Steps:**
1. `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog`
2. `pnpm run lingui:extract`
3. Inspect: `grep -c '"integration.slack.' packages/workflows/src/catalog/actions.generated.ts` and confirm
   none of `info`, `blocks`, `sendAsBot`, `mentionOriginFlow`, `file` appear inside the
   `integration.slack.send_channel_message` block.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: exit 0, no staleness report
grep -o '"integration\.slack\.[a-z_-]*"' packages/workflows/src/catalog/actions.generated.ts | sort -u
# Expected: exactly the 4 step ids
pnpm --filter @carbon/workflows test
# Expected: all pass (catalog.test.ts still green)
```

**Out of scope:** hand-editing any generated file.

---

## Task 12: Sync the rule doc and spec status

**Depends on:** 11
**Files:**
- Modify: `.claude/rules/workflow-integrations.md`
- Modify: `.ai/specs/2026-09-01-slack-workflow-piece.md` — status line → `Status: implemented`; changelog entry

**Steps:**
1. Rule doc edits (short, in the existing voice):
   - "Curated, not a marketplace": "the allowlist has one" → "the allowlist has two (Google Calendar, Slack)".
   - "The form shows a curated subset": add a paragraph on `omit` (removed from both maps; pin still sent;
     required needs a value; `MARKDOWN` auto-omitted; an unmappable type must be `omit`ted explicitly —
     never dropped silently).
   - "OAuth round trip": the consent URL is `buildConsentUrl`; allowlist `oauth.authUrl`/`scope` overrides
     and why (Slack's `user_scope`).
   - "The settings UI is the ordinary integration card": the callback calls `markIntegrationInstalled`
     (never overwrites metadata) and why; a card MAY be shared with another flow (Slack/Assistant) —
     the builder deep-links `?tab=connections`.
   - "Adding a piece": step 4 becomes conditional ("if the card is new"); mention `omit` in step 6.
2. Spec: status + changelog `2026-09-01 — Implemented; see .ai/runs/2026-09-01-slack-workflow-piece.md`.

**Verify:**
```bash
grep -n "allowlist has two\|omit\|buildConsentUrl\|markIntegrationInstalled" .claude/rules/workflow-integrations.md | wc -l
# Expected: ≥ 4
```

**Out of scope:** other rule files.

---

## Task 13: End-to-end verification + run log

**Depends on:** 12
**Files:**
- Create: `.ai/runs/2026-09-01-slack-workflow-piece.md` (format: copy `.ai/runs/2026-08-27-workflow-integrations.md`)

**Steps:**
1. Automated gates, all must pass:
   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/ee --filter=@carbon/env --filter=@carbon/workflows --filter=erp
   pnpm --filter @carbon/jobs test
   pnpm --filter @carbon/ee test
   pnpm --filter @carbon/workflows test
   pnpm run check:workflow-catalog
   pnpm exec biome check packages/jobs/src/workflows/integrations packages/ee/src/integrations packages/ee/src/slack apps/erp/app/routes/api+ apps/erp/app/modules/settings apps/erp/app/modules/workflows/ui/Builder/config/forms
   ```
2. Browser criteria (spec Acceptance 8–10) require the Slack app manifest to carry the new redirect URL
   and the 10 bot scopes. Record each as VERIFIED or UNVERIFIED-PENDING-MANIFEST in the run log; do not
   claim a browser criterion without doing it.
3. Run log table: one row per task with the concrete artefact, then "Automated gates" output summary,
   then the browser matrix, then "Not committed" (per the user's rule — the user commits).

**Verify:**
```bash
test -f .ai/runs/2026-09-01-slack-workflow-piece.md && grep -c "Task" .ai/runs/2026-09-01-slack-workflow-piece.md
# Expected: file exists, ≥ 13
```

**Out of scope:** committing, pushing, editing the Slack app manifest.
