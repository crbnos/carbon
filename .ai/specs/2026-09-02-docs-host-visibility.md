# Docs Host Visibility

> Status: draft
> Author: Aashu (via ship-it, autonomous mode)
> Date: 2026-09-02

## Reading of the request

**What:** make every host shown in the docs site either correct for the reader's
instance, or visibly marked as unknown — never a confident wrong hostname.
**Why:** the docs hardcode `https://rest.carbon.ms`; that is wrong for
self-hosted customers and for non-default regions, and a reader has no signal
that it is wrong. **Where:** the `docs/` Next app (display + config) and
`apps/erp` (the handoff that tells docs which instance the reader came from).
**Who:** two populations — signed-in Carbon users arriving from the ERP's
avatar menu (host is knowable), and search-engine/direct visitors (host is
genuinely unknown, and is the common case).

## TLDR

The docs API/MCP reference presents `https://rest.carbon.ms` as fact in every
endpoint URL, code sample and MCP snippet. That host is correct only for the
default Carbon Cloud deployment. This spec adds (1) an explicit ERP → docs host
handoff via a `?host=` query param sourced from `CARBON_API_URL`, (2) ingestion
of that param into the existing `ApiConfigProvider`, and (3) a genuine third
config state — **host unknown** — which renders the origin portion of every URL
as a clickable `<your-host>` placeholder that opens the existing Configurator,
while leaving paths accurate. Unknown becomes the new default for unconfigured
visitors, replacing today's silent `rest.carbon.ms` assumption.

## Problem Statement

`docs/scripts/generate-api-docs.mjs:19` bakes `const BASE = "https://rest.carbon.ms"`
into every generated sample at build time. At render, `applyBase`/`applyConfig`
(`docs/components/api/config-context.tsx`) string-replace that literal with the
reader's configured base. The substitution machinery works — the defect is the
*default*:

- `DEFAULT_API_BASE = "https://rest.carbon.ms"` is used as the initial value, so
  an unconfigured reader sees a fully-formed, authoritative-looking URL that is
  wrong for their instance. Concretely, a self-hosted reader is told to
  `curl 'https://rest.carbon.ms/item?limit=1'` — a host they cannot reach.
- `isDefault` conflates "the reader deliberately chose Carbon Cloud" with "the
  reader has never touched the configurator". Those are different facts and only
  the first justifies displaying `rest.carbon.ms`.
- A reader arriving from their own ERP instance gets no benefit from the fact
  that the ERP already knows the correct host.

Self-hosted deployments have arbitrary domains — `sst.config.ts` shows
`URL_ERP`/`DOMAIN` fully overridable, with no `rest.*` naming convention to rely
on — so the host cannot be guessed from anything the docs site knows on its own.

## Proposed Solution

Three parts, in dependency order.

### Part 1 — ERP → docs host handoff

The ERP already knows its REST origin: `CARBON_API_URL` (`packages/env/src/index.ts:155`),
which falls back to `SUPABASE_URL` — Carbon's REST API is PostgREST served by
Supabase, which is why samples are PostgREST-shaped (`/item?select=*&limit=10`).
It is already client-safe: it is in `getBrowserEnv()` (`packages/env/src/index.ts:524`)
and already flows into `apps/erp/app/root.tsx`'s `env` payload (`root.tsx:84,115`).

`path.to.apiDocs` and `path.to.mcpDocs` (`apps/erp/app/utils/path.ts:320,1383`)
become functions taking an optional host and appending `?host=<encoded>`.
`AvatarMenu.tsx:122` reads `CARBON_API_URL` from root loader data via the
existing `useRouteData` idiom and passes it.

Deliberately **not** referrer-based: the link carries `rel="noreferrer"`, and
even without it `strict-origin-when-cross-origin` sends only the bare ERP
origin, which does not identify the REST host on a self-hosted deployment where
the two are unrelated domains.

### Part 2 — docs ingests the param

A client-side effect in `ApiConfigProvider` reads `?host=` on mount, validates
it with the same rules as the configurator's `parseBaseUrl` (extracted to a
shared module so validation cannot drift), and adopts it.

**Precedence:** an explicit saved choice wins over the param. Order:
`localStorage` (reader set it themselves) → `?host=` param → unknown. Rationale:
the param is a *hint from a referrer*, while localStorage is a *decision by the
reader*; silently overwriting the latter would make the configurator feel
broken for someone who deliberately set a different instance.

**A param host is display-only** (revised during review). It is NOT persisted and
never carries the reader's stored API key. Persisting it would let one crafted
link permanently redirect a reader's samples, and pasting their key into samples
aimed at a link-supplied host would hand that link the credential. The dialog is
what turns a host into the reader's own choice. Credentials are additionally
withheld from any cleartext `http:` host except loopback, since a key in a
copy-pasted `http://` sample is a key on the wire.

**Two origins, not one.** `ERP_URL` and `CARBON_API_URL` are configured
independently upstream and need not share a domain, so the ERP sends both
(`?host=` and `?app=`). The `rest.` → `app.` rewrite survives only as a fallback
for a host the reader typed themselves.

### Part 3 — the unknown-host state (the core)

`base` becomes `string | null`, where `null` means "host unknown". This is a
third state distinct from Cloud and self-hosted:

| State | `base` | Displayed origin |
|---|---|---|
| Unknown (new default) | `null` | `<your-host>` placeholder, clickable |
| Carbon Cloud | `https://rest.carbon.ms` | real host |
| Self-hosted / regional | reader's URL | real host |

Rendering rules:

- **Paths stay real** in every state — only the origin is replaced. A reader can
  always learn the correct route shape even before configuring.
- **Rendered UI** (`BaseUrl` chip, `CodePanel` header, inline `McpEndpoint`):
  `<your-host>` renders as a distinct clickable control that opens the
  Configurator, styled with existing `ed-*` tokens.
- **Code samples**: the placeholder appears as literal `<your-host>` text —
  copy-paste-obvious as a placeholder, matching how `<api-key>` already reads.
  It is intentionally *not* clickable inside shiki HTML: injecting interactive
  markup into `dangerouslySetInnerHTML` blocks would mean parsing highlighted
  HTML, which is fragile. The panel header and the sidebar trigger both offer
  the clickable path, so the affordance is never more than one glance away.
- **Escaping**: `applyConfig` substitutes `<your-host>` through the same
  encoding-proof path as `<api-key>` — shiki encodes `<`/`>` variously
  (`&#x3C;`, `&#60;`, `&lt;`), so all three forms are covered, and any
  substituted value is HTML-escaped before injection.

The configurator gains a third mode card ("Not sure yet" / unknown) so the state
is reachable and reversible, and its trigger shows the placeholder rather than a
hostname when unknown.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Host source in ERP | `CARBON_API_URL` (falls back to `SUPABASE_URL`) | Already the REST origin and already client-safe in `getBrowserEnv()`; no new env var, works for self-hosted |
| Handoff mechanism | Explicit `?host=` query param | Referrer is stripped by `rel="noreferrer"` and only ever carries the ERP origin, which ≠ REST host when self-hosted |
| Unknown representation | `base: string \| null` | Makes the third state unrepresentable-as-Cloud; forces every consumer to handle it at the type level |
| Precedence | localStorage > `?host=` > unknown | Reader's own decision outranks a referrer hint |
| Placeholder token | `<your-host>` | Mirrors the existing `<api-key>` convention readers already understand |
| Clickable in code samples | No — rendered UI only | Avoids parsing/injecting into shiki HTML; affordance still present in header + sidebar |
| Default for new visitors | Unknown | The honest state; showing `rest.carbon.ms` to a self-hosted reader is the bug being fixed |
| Docs i18n | Plain English strings | The docs app has zero Lingui usage in its own components (the SWC plugin exists only for `@carbon/glossary`); matching local idiom |
| ERP i18n | Lingui `Trans`/`useLingui` | Existing idiom in `AvatarMenu.tsx:26` |
| Static generation | Preserved | Host applied client-side only; `generateStaticParams` prerendering untouched |

## Data Model Changes

N/A — no database involvement. Client-side state only (React context +
`localStorage` key `carbon-api-base`, which already exists).

## API / Service Changes

No server APIs change. Two surface changes:

- `path.to.apiDocs` / `path.to.mcpDocs`: string → `(host?: string) => string`.
  Internal to `apps/erp`; both call sites are updated. Query param is additive
  and safe when signed out or absent.
- `docs` `useApiConfig()` context: `base: string` → `base: string | null`, plus
  `isUnknown`. Internal to the docs app; all consumers updated in this change.

## UI Changes

- `docs/components/api/config-context.tsx` — nullable base, param ingestion,
  precedence, `<your-host>` substitution in `applyBase`/`applyConfig`.
- `docs/components/api/configurator.tsx` — third mode card; trigger reflects
  unknown; `parseBaseUrl` extracted for reuse.
- `docs/components/api/base-url.tsx`, `code-panel.tsx`, `config-inline.tsx` —
  render the placeholder control when unknown.
- New: a small `HostPlaceholder` client component (the clickable `<your-host>`),
  and a shared way to open the Configurator from anywhere in the tree (dialog
  open state lifted into the config context).
- `apps/erp/app/components/AvatarMenu.tsx` — pass the host on the API docs link.
- `docs/app/mcp/page.tsx:25` — `ENDPOINT` constant is currently a hardcoded
  `https://app.carbon.ms/api/mcp` baked into code samples; routed through the
  same substitution so it respects the configured/unknown host.

## Acceptance Criteria

1. A visitor loading `/api-reference/items/part` with empty `localStorage` and no
   query param sees `<your-host>/part` in the Base chip and `<your-host>` in the
   cURL sample — not `rest.carbon.ms`.
2. Clicking the `<your-host>` chip on that page opens the API configuration
   dialog.
3. Entering `https://api.acme-mfg.com` and saving makes every endpoint URL, code
   sample, MCP endpoint and Settings link on the page read
   `api.acme-mfg.com`; reloading the page preserves it.
4. Choosing "Carbon Cloud" in the dialog shows `rest.carbon.ms` everywhere —
   the Cloud state still works and is now an explicit choice.
5. Loading `/api-reference?host=https%3A%2F%2Fapi.acme-mfg.com` with empty
   `localStorage` adopts that host with no dialog interaction.
6. With `localStorage` already set to `https://api.foo.com`, loading
   `?host=https://api.bar.com` keeps `api.foo.com` (explicit choice wins).
7. An invalid `?host=` value (e.g. `?host=javascript:alert(1)` or `?host=notaurl`)
   is rejected and the page falls back to unknown rather than rendering it.
8. Clicking "API Documentation" in the ERP avatar menu opens the docs with the
   deployment's `CARBON_API_URL` as `?host=`, and the docs immediately show that
   host.
9. Copying a code sample in the unknown state yields text containing the literal
   `<your-host>`, with no HTML entities (`&#x3C;`) leaking into the clipboard.
10. `pnpm exec turbo run typecheck --filter=docs --filter=@carbon/erp` and
    `pnpm run lint` pass.

## Non-Goals

- Auto-detecting the host from the `Referer` header (rejected above).
- Changing the build-time generator's `BASE` literal or the generated JSON shape.
- Persisting host config server-side or per-account — it stays per-browser.
- Rewriting hardcoded `docs.carbon.ms` links in `packages/onboarding` or
  `packages/react/src/LabelWithHelp.tsx` — those point at the docs *site*, not a
  customer API host, and are correct as-is.
- Touching the `.mdx` prose in `docs/content/**` that mentions `app.carbon.ms`
  in a self-hosting/architecture context, where the literal is accurate.

## Open Questions

All resolved before writing (autonomous mode).

- [x] Should the host come from the referrer or an explicit param? — **Autonomous:**
  explicit `?host=` param. Referrer is unusable here: `rel="noreferrer"` is on the
  link and the default referrer policy sends only the origin, which is not the
  REST host for self-hosted. (Rung 2: codebase evidence.)
- [x] Which ERP value is the REST origin? — **Autonomous:** `CARBON_API_URL`,
  fallback `SUPABASE_URL`; already client-safe and already in the root loader.
  Alternatives (`VERCEL_URL`, deriving `rest.` from the ERP origin) are wrong —
  the former is the ERP's own URL, the latter assumes a naming convention that
  `sst.config.ts` shows does not hold. (Rung 2.)
- [x] What wins when both a saved choice and a param exist? — **Autonomous:**
  localStorage. A reader's explicit decision should not be silently overwritten
  by a referrer hint. (Rung 5: product judgement.)
- [x] How is unknown represented in the type? — **Autonomous:** `base: string | null`
  over a parallel boolean, so consumers cannot forget the state. (Rung 5.)
- [x] Should `<your-host>` be clickable inside code samples? — **Autonomous:** no.
  Options were: parse shiki HTML and inject a button (fragile, defeats the
  build-time highlight), render samples from tokens client-side (large rewrite),
  or keep samples literal and put the affordance in the panel header/sidebar
  (chosen — smallest change that still leaves the control one glance away).
  (Rung 5, YAGNI.)
- [x] Does new docs copy need Lingui? — **Autonomous:** no. Zero docs components
  use Lingui; the SWC plugin exists only so `@carbon/glossary`'s macros compile.
  ERP-side copy does use Lingui. Matching local idiom in each app. (Rung 2.)
- [x] Does this break static generation? — **Autonomous:** no. Host resolution is
  client-side; `generateStaticParams` and the prerendered HTML are untouched. (Rung 2.)
- [x] What about the hardcoded MCP `ENDPOINT` in `app/mcp/page.tsx:25`? —
  **Autonomous:** route it through the same substitution. Discovered while writing;
  leaving it hardcoded would make the MCP page contradict the API pages. (Rung 1:
  the user's stated intent covers MCP routes explicitly.)

## Autonomous Decisions

Eight decisions were made without the user. High-stakes first:

1. **Public-ish contract change** — `path.to.apiDocs`/`mcpDocs` change from string
   constants to functions. Confined to `apps/erp`; both call sites updated. Worth
   a reviewer's glance since `path.to` is a widely-used object.
2. **Context type change** — `base` becomes nullable across the docs app, which
   touches every consumer of `useApiConfig`. Deliberate: it makes the unknown
   state impossible to ignore.
3. **Default behaviour change** — unconfigured visitors now see `<your-host>`
   instead of `rest.carbon.ms`. This is the point of the feature, but it does
   change what every anonymous docs reader sees today.
4. **Scope narrowing** — `<your-host>` is not clickable *inside* code samples
   (rationale above). This is the one place the implementation is less than the
   literal request, which asked for it to be clickable; the affordance is
   preserved in the panel header and sidebar instead.

5. **Wider blast radius than requested (in ERP)** — `path.to.apiDocs` turned out
   to have seven call sites, not the one named in the request. Rather than make it
   a function and edit all seven, the host is appended once inside `path.ts` via
   `withDocsHost()`. Consequence: the API-docs links in the Help menu, the API
   Keys table and the Webhooks table now also carry the host. That is more than
   the literal request (which named only the avatar menu), and it is the reason
   `AvatarMenu.tsx` needed no edit at all.

Lower-stakes: host source (`CARBON_API_URL`), precedence rule, no-Lingui in docs,
including the MCP `ENDPOINT` constant in scope.

## Changelog

- 2026-09-02 — Initial spec, written in ship-it autonomous mode. All eight open
  questions resolved without user input; see Autonomous Decisions.
- 2026-09-02 — During execution, decision 9 added: `apiDocs`/`mcpDocs` stay
  strings and gain the host inside `path.ts` (`withDocsHost`), instead of becoming
  host-taking functions. Driven by the seven-call-site discovery and by
  `CARBON_API_URL` already being available on `window.env` via `@carbon/auth`.
