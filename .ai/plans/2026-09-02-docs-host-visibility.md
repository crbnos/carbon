# Docs Host Visibility — implementation plan

**Spec / source:** `.ai/specs/2026-09-02-docs-host-visibility.md`
**Branch:** `feat/docs-link-visibility`
**Worktree:** `/Users/aashu/work/carbon/carbon-feat-docs-link-visibility`
**Mode:** ship-it autonomous

## Progress
- [x] Task 1: Extract `parseBaseUrl` into a shared module
- [x] Task 2: Make `base` nullable + ingest `?host=` in `ApiConfigProvider`
- [x] Task 3: Add `<your-host>` substitution to `applyBase`/`applyConfig`
- [x] Task 4: Build the `HostPlaceholder` clickable control
- [x] Task 5: Add the "unknown" third mode to the Configurator
- [x] Task 6: Render the placeholder in `BaseUrl`, `CodePanel`, `config-inline`
- [x] Task 7: Route the MCP page's hardcoded `ENDPOINT` through the config
- [x] Task 8: ERP — pass `CARBON_API_URL` as `?host=` on the docs links
- [x] Task 9: Typecheck + lint
- [x] Task 10: End-to-end verification against the acceptance criteria

## Dependencies

- Task 1 → Task 2 (provider imports the shared validator)
- Tasks 2, 3 → Tasks 4, 5, 6, 7 (they consume the nullable `base` + new helpers)
- Task 4 → Task 6 (placeholder component used by consumers)
- Task 8 is **independent** of Tasks 1–7 (different app) — may run in parallel
- Tasks 9, 10 last

## Environment note

This worktree had no `node_modules`; `pnpm install` was started at plan time.
All Verify blocks require it to have finished. If `turbo` is still "not found",
wait for the install to complete before treating a failure as real.

---

## Task 1: Extract `parseBaseUrl` into a shared module

**Depends on:** none
**Files:**
- Create: `docs/components/api/base-url-parse.ts`
- Modify: `docs/components/api/configurator.tsx` — delete the local
  `parseBaseUrl` (lines ~48–67) and import it from the new module instead.

**Steps:**
1. Create `docs/components/api/base-url-parse.ts` containing exactly the
   existing `parseBaseUrl` implementation moved verbatim from
   `configurator.tsx`, exported:

```ts
/** Validate/normalize a user-entered base URL. Returns the cleaned URL or an error message. */
export function parseBaseUrl(raw: string): { url: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: "Enter a URL" };
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { error: "Not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "Use http:// or https://" };
  }
  const host = u.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (host !== "localhost" && !isIp && !host.includes(".")) {
    return { error: "Enter a valid host (e.g. rest.carbon.ms)" };
  }
  return { url: (u.origin + u.pathname).replace(/\/+$/, "") };
}
```

2. In `configurator.tsx`, remove the local definition and add
   `import { parseBaseUrl } from "./base-url-parse";`.
3. Do not change the validation rules. The `javascript:` scheme is already
   rejected by the `http:`/`https:` check — that is the guard acceptance
   criterion 7 depends on.

**Verify:**
```bash
grep -c "function parseBaseUrl" docs/components/api/configurator.tsx
# Expected: 0
grep -c "export function parseBaseUrl" docs/components/api/base-url-parse.ts
# Expected: 1
```

**Out of scope:** changing validation behaviour; the rest of `configurator.tsx`.

---

## Task 2: Make `base` nullable and ingest the `?host=` param

**Depends on:** Task 1
**Files:**
- Modify: `docs/components/api/config-context.tsx`

**Steps:**
1. Change the context type so unknown is representable:

```ts
type Ctx = {
  base: string | null;          // null = host unknown
  setBase: (v: string | null) => void;
  isDefault: boolean;           // true only when base === DEFAULT_API_BASE
  isUnknown: boolean;           // true when base === null
  apiKey: string;
  setApiKey: (v: string) => void;
  openConfigurator: () => void; // lets any consumer open the dialog
  configuratorOpen: boolean;
  setConfiguratorOpen: (v: boolean) => void;
};
```

2. Default the state to `null` (unknown), NOT `DEFAULT_API_BASE`.
3. In the mount effect, resolve in this precedence order (spec Part 2):
   1. `localStorage.getItem("carbon-api-base")` — if present and non-empty, use it.
   2. Otherwise read `?host=` from `window.location.search`, validate with
      `parseBaseUrl` from `./base-url-parse`, and if valid use it **and persist
      it** to `localStorage` under the same key.
   3. Otherwise leave `null`.
   Wrap all storage access in `try {} catch {}`, matching the existing style.
4. `setBase` accepts `null`: when null, `localStorage.removeItem(BASE_STORAGE_KEY)`
   and set state to null; otherwise trim/strip trailing slashes as today. Note
   the current `|| DEFAULT_API_BASE` fallback must be removed so an explicit
   null is not coerced back to Cloud.
5. Add the `configuratorOpen` state here (the Configurator will consume it) so
   any component can trigger the dialog.
6. Keep `DEFAULT_API_BASE` exported and unchanged.
7. Update `appOrigin` to accept `string | null`; when `null`, return `null` so
   callers render the placeholder rather than `app.carbon.ms`.

**Verify:**
```bash
grep -n "base: string | null" docs/components/api/config-context.tsx
# Expected: a match in the Ctx type
grep -n "useState<string | null>(null)" docs/components/api/config-context.tsx
# Expected: a match — unknown is the initial state
```

**Out of scope:** the `applyBase`/`applyConfig` bodies (Task 3); UI components.

**Escape hatch:** if `localStorage` currently holds `https://rest.carbon.ms`
from a previous visit, that is a legitimate explicit Cloud choice and must be
honoured as Cloud, not converted to unknown.

---

## Task 3: Add `<your-host>` substitution to `applyBase`/`applyConfig`

**Depends on:** Task 2
**Files:**
- Modify: `docs/components/api/config-context.tsx`

**Steps:**
1. Add the placeholder constant beside the existing one:

```ts
export const HOST_PLACEHOLDER = "<your-host>";
```

2. `applyBase(text, base)` — when `base` is `null`, replace occurrences of
   `DEFAULT_API_BASE` with `HOST_PLACEHOLDER`; when it is a string, keep today's
   behaviour (replace with `base`, no-op when it equals the default).
3. `applyConfig(text, base, apiKey, html)` — same nullable handling, and it must
   also swap the MCP endpoint. When `base` is null, `DEFAULT_MCP_ENDPOINT`
   becomes `` `${HOST_PLACEHOLDER}/api/mcp` ``.
4. **Encoding-proof substitution (critical).** In the `html` path the sample is
   shiki HTML where `<`/`>` are entity-encoded. The *inserted* placeholder must
   be encoded the same way or it will be swallowed as a bogus tag. Emit
   `&lt;your-host&gt;` when `html` is true and the literal `<your-host>` when it
   is false, exactly mirroring how `<api-key>` is handled today. Reuse the
   existing `escapeHtml` helper for any substituted real value.
5. Copy-to-clipboard uses the non-html path, so criterion 9 (clipboard contains
   literal `<your-host>`, no `&#x3C;`) follows from step 4.

**Verify:**
```bash
grep -n "HOST_PLACEHOLDER" docs/components/api/config-context.tsx
# Expected: at least 3 matches (definition, applyBase, applyConfig)
grep -n "&lt;your-host&gt;" docs/components/api/config-context.tsx
# Expected: at least 1 match — the html-encoded emission path
```

**Out of scope:** `generate-api-docs.mjs` and the generated JSON — the build-time
`BASE` literal stays exactly as it is; all swapping is at render time.

---

## Task 4: Build the `HostPlaceholder` clickable control

**Depends on:** Tasks 2, 3
**Files:**
- Create: `docs/components/api/host-placeholder.tsx`
- Copy from (precedent): `docs/components/api/base-url.tsx` (client-component
  shape + `ed-*` token usage) and `docs/components/api/configurator.tsx`
  (trigger button styling: `border-ed-warm-300`, `hover:border-ed-warm-500`).

**Steps:**
1. Create a `"use client"` component:

```tsx
"use client";

import { HOST_PLACEHOLDER, useApiConfig } from "./config-context";

/** The `<your-host>` stand-in shown when the reader's instance is unknown.
 *  Clicking it opens the API configuration dialog. */
export function HostPlaceholder() {
  const { openConfigurator } = useApiConfig();
  return (
    <button
      type="button"
      onClick={openConfigurator}
      title="Set your Carbon instance"
      className="rounded-[5px] border border-dashed border-ed-warm-500 bg-ed-brand/7 px-[5px] py-px font-mono text-ed-brand-ink transition-colors hover:border-ed-brand hover:bg-ed-brand/12"
    >
      {HOST_PLACEHOLDER}
    </button>
  );
}
```

2. Plain English copy — the docs app uses no Lingui (spec Design Decisions).
3. Only `ed-*` tokens already present in this directory; introduce no new colors.

**Verify:**
```bash
grep -n "openConfigurator" docs/components/api/host-placeholder.tsx
# Expected: 1 match
grep -rn "ed-brand-ink\|ed-warm-500" docs/components/api/configurator.tsx | head -2
# Expected: matches, proving the tokens used already exist in this directory
```

**Out of scope:** using it in consumers (Task 6).

---

## Task 5: Add the "unknown" third mode to the Configurator

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `docs/components/api/configurator.tsx`

**Steps:**
1. Widen the mode state: `useState<"unknown" | "cloud" | "self">`.
2. Seed it in `onOpenChange`: `isUnknown ? "unknown" : isDefault ? "cloud" : "self"`.
3. The Environment section currently renders two `ModeCard`s in a
   `grid-cols-2`. Add a third card and change to `grid-cols-3`:
   - title `"Not sure"`, sub `"Show <your-host>"`, active when `mode === "unknown"`.
   Keep the existing `ModeCard` component as-is — it already takes
   `active`/`onClick`/`title`/`sub`.
4. In `save()`: `mode === "unknown"` → `setBase(null)`; `"cloud"` →
   `setBase(DEFAULT_API_BASE)`; `"self"` → validate and `setBase(result.url)`
   (unchanged).
5. `reset()` sets `mode` to `"unknown"` (the honest default) instead of `"cloud"`.
6. The trigger button shows `host` derived from `base`; when `base` is null show
   the literal `<your-host>` string there instead of a hostname, so the sidebar
   reflects the unknown state.
7. Drive `Dialog.Root` from the context's `configuratorOpen`/`setConfiguratorOpen`
   (added in Task 2) instead of local `open` state, so `HostPlaceholder` can open
   it. Keep `onOpenChange` doing its draft-seeding work.
8. Both layouts render `<Configurator />` twice (mobile + sidebar). The mobile
   one in `MainHeader` sits **outside** `ApiConfigProvider` in both
   `docs/app/api-reference/layout.tsx` and `docs/app/mcp/layout.tsx`. Moving the
   provider is out of scope; instead ensure `useApiConfig`'s default context
   value keeps that instance harmless — it already returns defaults rather than
   throwing. Set the default context's `base` to `null` and `openConfigurator`
   to a no-op so the outside-provider instance renders the unknown state and
   does not crash.

**Verify:**
```bash
grep -n "grid-cols-3" docs/components/api/configurator.tsx
# Expected: 1 match in the Environment section
grep -n '"unknown"' docs/components/api/configurator.tsx
# Expected: several matches (state type, seed, save, reset)
```

**Out of scope:** restructuring the layouts or moving `ApiConfigProvider`.

---

## Task 6: Render the placeholder in `BaseUrl`, `CodePanel`, `config-inline`

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `docs/components/api/base-url.tsx` — show `<HostPlaceholder />` +
  real path when `base` is null.
- Modify: `docs/components/api/code-panel.tsx` — the header currently renders
  `applyBase(fullPath, base)`; when unknown, render `<HostPlaceholder />`
  followed by the path portion.
- Modify: `docs/components/api/config-inline.tsx` — `McpEndpoint` and
  `ApiKeysLink` must handle a null `appOrigin`.

**Steps:**
1. `base-url.tsx`: when `isUnknown`, render the same chip but with
   `<HostPlaceholder />` in place of the `{base}` text; `{path}` is unchanged.
   Paths stay real in every state (spec Part 3).
2. `code-panel.tsx`: `fullPath` arrives as `` `${base}${endpoint.path}` `` built
   server-side with the build-time base. When `isUnknown`, strip the
   `DEFAULT_API_BASE` prefix and render `<HostPlaceholder />` + the remainder,
   so the method/path header reads `<your-host>/part`. The `<CopyButton>` and
   the shiki `dangerouslySetInnerHTML` blocks keep calling `applyConfig`, which
   Task 3 already made unknown-aware — do not hand-edit their HTML.
3. `config-inline.tsx`: `McpEndpoint` renders `<Code><HostPlaceholder />/api/mcp</Code>`
   when `appOrigin(base)` is null. `ApiKeysLink` cannot produce a working href
   for an unknown host — render it as a `HostPlaceholder`-triggered button (same
   affordance, opens the configurator) instead of a dead link. `AuthHeader` is
   host-independent; leave it unchanged.

**Verify:**
```bash
grep -ln "HostPlaceholder" docs/components/api/base-url.tsx docs/components/api/code-panel.tsx docs/components/api/config-inline.tsx
# Expected: all three files listed
```

**Out of scope:** `endpoint-section.tsx` — it is a server component and keeps
passing the build-time `base`; the client components do the swapping.

---

## Task 7: Route the MCP page's hardcoded `ENDPOINT` through the config

**Depends on:** Tasks 3, 6
**Files:**
- Modify: `docs/app/mcp/page.tsx` — line 25 `const ENDPOINT = "https://app.carbon.ms/api/mcp";`

**Steps:**
1. Leave `ENDPOINT` as the literal used to build the `CLAUDE_CODE` and `CURSOR`
   sample strings at module scope — those are passed to `<CodeBlock>`, whose
   `applyConfig` call already rewrites `DEFAULT_MCP_ENDPOINT` (Task 3). Confirm
   the literal is byte-identical to `DEFAULT_MCP_ENDPOINT` in
   `config-context.tsx` so the substitution actually matches.
2. If it differs in any way, import `DEFAULT_MCP_ENDPOINT` and use it, rather
   than duplicating the string.
3. The prose `<McpEndpoint />` on line 107 is already reactive via Task 6.

**Verify:**
```bash
grep -n "api/mcp" docs/app/mcp/page.tsx docs/components/api/config-context.tsx
# Expected: the page's ENDPOINT and DEFAULT_MCP_ENDPOINT are the same URL string
```

**Out of scope:** `.mdx` prose under `docs/content/**` mentioning `app.carbon.ms`
in self-hosting/architecture contexts, where the literal is correct (spec Non-Goals).

---

## Task 8: ERP — pass `CARBON_API_URL` as `?host=` on the docs links

**Depends on:** none (independent of Tasks 1–7; different app)
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — line 320 `apiDocs`, line 1383 `mcpDocs`
- Modify: `apps/erp/app/components/AvatarMenu.tsx` — line 122 link

**Steps:**
1. In `path.ts`, convert both constants to functions taking an optional host:

```ts
apiDocs: (host?: string) =>
  host
    ? `https://docs.carbon.ms/api-reference?host=${encodeURIComponent(host)}`
    : "https://docs.carbon.ms/api-reference",
```

   and the same shape for `mcpDocs` with `https://docs.carbon.ms/mcp`. Keep them
   at their existing alphabetical positions in the object.
2. Find every existing reference and update it to a call:
   `grep -rn "path.to.apiDocs\|path.to.mcpDocs" apps/erp/app`. Known site:
   `AvatarMenu.tsx:122`. Update all matches the grep returns.
3. In `AvatarMenu.tsx`, read the client-safe `CARBON_API_URL` that
   `apps/erp/app/root.tsx` already puts in its loader `env` payload
   (`root.tsx:84,115`), using the `useRouteData` idiom already used across the
   app, e.g.:

```tsx
const rootData = useRouteData<{ env: { CARBON_API_URL?: string } }>("/");
```

   Confirm the actual root route id/path used by other `useRouteData` callers in
   this app and match it exactly — do not guess the route key.
4. Pass it: `<a href={path.to.apiDocs(rootData?.env?.CARBON_API_URL)} ...>`.
   The link keeps `target="_blank" rel="noreferrer"` — the param carries the
   host, so the referrer is deliberately not relied upon.
5. Do not add or change any user-facing string here, so no new Lingui messages
   are introduced. The existing `<Trans>API Documentation</Trans>` is untouched.

**Verify:**
```bash
grep -rn "path.to.apiDocs\|path.to.mcpDocs" apps/erp/app
# Expected: every occurrence is a call with parentheses, no bare constant use
```

**Out of scope:** `packages/onboarding` and `packages/react/src/LabelWithHelp.tsx`
docs links — they target the docs site itself, not a customer API host (spec Non-Goals).

**Escape hatch:** if `CARBON_API_URL` turns out not to be present in the root
loader's `env` payload at runtime, re-decide using the ship-it resolution ladder
(next candidate: `SUPABASE_URL`, the value `CARBON_API_URL` already falls back
to), record it in the spec's Autonomous Decisions, and continue. Do not silently
hardcode a host.

---

## Task 9: Typecheck and lint

**Depends on:** Tasks 1–8
**Files:** none (verification only)

**Steps:**
1. Ensure `pnpm install` has completed in this worktree.
2. Run the scoped typechecks and the linter. Whole-repo `typecheck` is
   documented in `AGENTS.md` as OOM-prone — keep it filtered.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=docs
# Expected: docs:typecheck exits 0, no TS errors
pnpm exec turbo run typecheck --filter=erp
# Expected: erp:typecheck exits 0, no TS errors
pnpm exec biome check docs/components/api apps/erp/app/components/AvatarMenu.tsx apps/erp/app/utils/path.ts
# Expected: no errors
```

**Out of scope:** unrelated pre-existing failures elsewhere in the repo — report
them, do not fix them in this change.

---

## Task 10: End-to-end verification against the acceptance criteria

**Depends on:** Task 9
**Files:** none (verification only)

**Steps:**
1. Start the docs app: `pnpm --filter docs dev` (serves on port 3002; the script
   runs `generate-api-docs.mjs` first).
2. Walk the spec's 10 acceptance criteria in a browser, in order. In particular:
   - Criterion 1: clear `localStorage` for `localhost:3002` first, then load
     `/api-reference/items/part` and confirm `<your-host>/part`, not `rest.carbon.ms`.
   - Criterion 6: set `carbon-api-base` to `https://api.foo.com` in devtools,
     then load `?host=https://api.bar.com` and confirm `api.foo.com` survives.
   - Criterion 7: load `?host=javascript:alert(1)` and `?host=notaurl`, confirm
     both fall back to unknown and neither is rendered.
   - Criterion 9: in the unknown state, click Copy on a cURL sample and confirm
     the clipboard has literal `<your-host>` and no `&#x3C;` / `&lt;`.
3. Report each criterion pass/fail with the observed output. Do not claim a
   criterion passes without having exercised it (`AGENTS.md`: evidence before
   assertions).

**Verify:**
```bash
pnpm --filter docs dev
# Expected: "Ready" on http://localhost:3002; then manual checks above
```

**Out of scope:** committing. Per the user's standing rule, do not run
`git commit` — report the change and wait for explicit approval.


---

## Execution deviations

**Task 8 — simpler than planned (implemented, verified).** The plan had
`apiDocs`/`mcpDocs` become functions taking a host, with `AvatarMenu` reading the
value through `useRouteData`. While implementing, two facts made that unnecessary:

1. `path.to.apiDocs` has **seven** call sites, not one (`AvatarMenu`, `HelpMenu`,
   `ApiKeysTable`, and four in `WebhooksTable`). Converting it to a function
   would have required editing all seven for no gain.
2. `CARBON_API_URL` is declared on `window.env` (`packages/env/src/index.ts:9`),
   read by `getEnv` in the browser (`index.ts:101-103`), and re-exported by
   `@carbon/auth` (whose `config/env.ts` is `export * from "@carbon/env"`).
   `path.ts` already imports `SUPABASE_URL` from `@carbon/auth` the same way and
   uses it at line 2235.

So `apiDocs`/`mcpDocs` stay plain strings, built once through a new `withDocsHost()`
helper in `path.ts`. Every call site — not just the avatar menu — now carries the
host, which is strictly better coverage than the plan specified. `AvatarMenu.tsx`
needed no change at all, so no Lingui strings were touched.

Resolution ladder rung 2 (codebase precedent). Recorded in the spec's Autonomous
Decisions as decision 9.

## Verification results (Task 9 + 10)

**Gates**
- `pnpm exec turbo run typecheck --filter=docs` → pass
- `pnpm exec turbo run typecheck --filter=erp` → pass (needed `turbo run typegen
  --filter=erp` first; this worktree had no generated route types, unrelated to
  this change)
- `pnpm --filter docs lint` → pass; `biome check apps/erp/app/utils/path.ts` → pass

**Acceptance criteria** — exercised against the real modules via `tsx`, plus the
running dev server on :3002. No browser automation is installed in this repo, so
the two criteria that are purely about click behaviour (2 and 4) are verified
structurally rather than by clicking.

| # | Criterion | Result |
|---|---|---|
| 1 | Unconfigured visitor sees `<your-host>/part`, not `rest.carbon.ms` | **PASS** — rendered page shows `curl … '<your-host>/part?select=*&limit=10'`; zero `rest.carbon.ms` outside the inert hydration payload |
| 2 | Clicking the chip opens the dialog | **PASS (structural)** — chip renders as `<button title="Set your Carbon instance">` bound to `openConfigurator`, which drives `Dialog.Root open={configuratorOpen}` |
| 3 | Saved host resolves everywhere + persists | **PASS** — `applyBase`/`applyConfig` substitute it; provider writes it to `localStorage` |
| 4 | Carbon Cloud mode still shows `rest.carbon.ms` | **PASS (structural)** — `applyBase(…, DEFAULT_API_BASE)` returns the sample unchanged; the cloud ModeCard calls `setBase(DEFAULT_API_BASE)` |
| 5 | `?host=` adopted with empty storage | **PASS** — adopted and persisted |
| 6 | Saved choice beats `?host=` | **PASS** — `api.foo.com` survives `?host=api.bar.com` |
| 7 | Invalid `?host=` rejected → unknown | **PASS** — `javascript:`, `data:`, `notaurl`, empty all rejected and not persisted |
| 8 | ERP link carries `CARBON_API_URL` | **PASS** — `withDocsHost` encodes it and round-trips through `URLSearchParams` |
| 9 | Copied sample has literal `<your-host>`, no entities | **PASS** — copy path yields `<your-host>`; html path yields `&lt;your-host&gt;` |
| 10 | Typecheck + lint | **PASS** |

Also verified: MCP endpoint swaps in both states (`<your-host>/api/mcp`, and
`app.acme.com` derived from `rest.acme.com`); API key and host substitute together;
`appOrigin(null)` returns null so no `app.carbon.ms` leaks into the unknown state;
a stored `rest.carbon.ms` is honoured as an explicit Cloud choice (escape hatch).
Routes `/api-reference/items/part`, `/mcp`, `/mcp/authentication` and the
`?host=` variant all return 200 with no server errors.

**Not committed** — per the user's standing rule, no `git commit` was run.

---

## Post-review fixes (thermo-nuclear-review)

Three findings, all fixed and browser-verified on real Chrome (desktop 1400x900
and mobile 390x844) via `playwright-core` + system Chrome. Playwright was
installed in the scratchpad only — no repo dependency was added.

**1. Mobile Configurator was inert (regression introduced by this branch).**
Lifting dialog state into context broke the Configurator inside `MainHeader`'s
mobile drawer, which renders outside `ApiConfigProvider` and so received the
default context's no-op setters. Browser testing showed it was worse than a dead
dialog: it opened, accepted a typed host, closed on Save — and silently discarded
it (`localStorage` stayed null). Fixed in two parts:
- `ApiConfigProvider` now wraps `MainHeader` too in both layouts, so the drawer's
  Configurator gets the real `setBase`/`setApiKey`.
- Dialog open state moved back to local `useState` in each Configurator; the
  context exposes an `openRequest` counter instead of a shared boolean. Two
  Configurators are mounted at once, so a shared boolean opened BOTH dialogs on
  one placeholder click (observed, then fixed). Each instance answers a bump only
  when its own trigger is the visible one, via a `triggerRef` offset check.

**2. Host not escaped on the html path.** `applyConfig` substituted a non-null
`base` into shiki HTML without `escapeHtml`, while the API key on the same path
was escaped. `new URL()` leaves `&` and `'` intact, so a host containing `&lt;`
rendered as a literal `<`. Not exploitable as XSS — `<`, `>`, `"` are
percent-encoded by `new URL()`, so no tag can be opened — but it displayed a host
the reader never entered and disagreed with the copy button. Fixed by collapsing
the two branches into one: `const host = base ?? HOST_PLACEHOLDER;` then
`html ? escapeHtml(host) : host`.

**3. `appOrigin` dropped the path prefix `parseBaseUrl` preserves.** An instance
at `https://acme.com/api/v1` got correct REST samples but an MCP endpoint and
Settings link with `/api/v1` missing. Now returns `(origin + pathname)` with the
trailing slash stripped, matching `parseBaseUrl`. Pre-existing, but this branch
widened its reach by routing the MCP page's ENDPOINT through it.

### Verification after fixes

- 21/21 unit assertions against the real modules (`applyBase`, `applyConfig`,
  `appOrigin`, `parseBaseUrl`) — includes new regression tests for fixes 2 and 3.
- 14/14 browser assertions: single dialog per click on both viewports, mobile save
  now persists, host-with-path renders, `?host=` adopted, saved choice beats the
  param, hostile param falls back to unknown, zero page errors.
- `typecheck --filter=docs`, `typecheck --filter=erp`, docs lint, biome on
  `path.ts` — all pass.

Still not committed.


---

## Post-review fixes (CodeRabbit)

**1. App origin was guessed from the REST host.** `appOrigin` rewrote `rest.` to
`app.`, but `ERP_URL` and `CARBON_API_URL` are separate settings that need not
share a domain, so MCP endpoints and Settings links could point somewhere wrong.
The ERP now sends both origins (`?host=` and `?app=`), `appOrigin(base, appBase)`
prefers the explicit value, and the rewrite remains only as a fallback for a
host the reader typed themselves.

**2. Client-module constant used by a server component.** `docs/app/mcp/page.tsx`
is a server component that interpolated `DEFAULT_MCP_ENDPOINT` from the
`"use client"` config module into build-time samples. Constants moved to a new
neutral `config-constants.ts` that both sides import; `config-context.tsx`
re-exports them so existing imports keep working.

**3. Credential exposure via `?host=`.** A reader with a saved API key who
followed a crafted `?host=evil` link (with no host of their own saved) got
samples pasting their real key at the attacker's host, and `parseBaseUrl` accepts
`http:`, so a key could go out in cleartext. A link-supplied host is now
display-only: never persisted, and never credential-trusted. The key is also
withheld from any cleartext host except loopback. Trust is *derived* at render
from where the base came from plus its scheme, rather than kept in a parallel
state flag — the first attempt used a `keyTrusted` state variable and immediately
desynced, withholding the key from legitimately saved hosts too.

### Pre-existing bug found while verifying #3

The configured API key never appeared in rendered code samples at all, on `main`
as well as this branch. Shiki escapes only what HTML requires, so the placeholder
comes back as `&#x3C;api-key>` — `<` hex-encoded, `>` raw — while `applyConfig`
matched only fully-encoded pairs (`&#x3C;api-key&#x3E;`). Now matched with a
regex accepting either bracket in any form. In scope because this change touches
that exact substitution path; verified against all five encodings.

### Verification after these fixes

- 16 unit assertions for the app-origin and constants changes, plus the original
  21 — all pass.
- 11 browser assertions for credential handling: key withheld from a
  link-supplied host, withheld over cleartext, still rendered for a saved https
  host, still rendered for loopback, param host not persisted.
- The full 14-assertion browser suite still passes.
- `typecheck --filter=docs`, `typecheck --filter=erp`, docs lint, biome on
  `path.ts` — all pass.
