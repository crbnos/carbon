# Consuming Activepieces Pieces in Carbon's Workflow Engine — Research Findings

Date: 2026-08-22. Question under study: can Carbon consume Activepieces "pieces"
(github.com/activepieces/activepieces, `packages/pieces`) inside its own workflow engine
to get hundreds of third-party connectors without maintaining them?

## TLDR

- **Yes, the raw material is available and MIT.** Pieces publish continuously to npm as
  `@activepieces/piece-<name>` (Slack piece updated 2026-08-21), the pieces framework is MIT
  (outside the `ee/` dirs), and there is a live public metadata API at
  `cloud.activepieces.com/api/v1/pieces` (name, version, logoUrl, auth schema, action/trigger
  counts) — verified firsthand.
- **Nothing official supports using pieces outside Activepieces.** Docs describe only
  build-and-publish-for-Activepieces; framework coupling is enforced by their engine (pieces
  ship with EMPTY npm dependencies), so Carbon must reimplement the host contract and pin
  versions itself.
- **Real precedent exists but is thin**: OpenOps vendored the whole architecture (pieces →
  "blocks", Apache-2.0 relicense); ActiveBoxes loads pieces from npm and had to polyfill EE
  interfaces; ATOM embeds a "Node.js Piece Engine (ActivePieces catalog)" in a foreign
  runtime. Nobody documents pieces-only reuse pain publicly.
- **The hard part is not code, it's OAuth**: Activepieces' shared OAuth apps are a paid
  platform feature of THEIR product; Carbon would need its own OAuth client apps per provider
  (Google restricted scopes ≈ 6-week review + annual CASA assessment) or a managed-auth vendor
  (Nango/Pipedream) underneath.
- **Security is a first-class concern**: pieces are npm code executed server-side; Activepieces
  has 9 published advisories (2025–2026) including a V8 sandbox bypass and cross-tenant code
  injection, and the Sept-2025 Shai-Hulud npm worm shows the supply-chain blast radius of
  auto-updating hundreds of packages.
- **No ERP embeds an open connector catalog today** — every surveyed ERP does curated native
  connectors + open API + Zapier/iPaaS partnership. Doing this would be genuinely novel.

## 1. Distribution facts

- **npm publishing — confirmed.** Pieces are published as `@activepieces/piece-<name>`;
  `@activepieces/piece-slack` is at 0.17.9, published 2026-08-21
  (https://registry.npmjs.org/@activepieces/piece-slack/latest). Framework packages:
  `@activepieces/pieces-framework` 0.32.0 and `@activepieces/pieces-common` 0.12.5, both last
  published 2026-06-17, ~2.6M and ~1.7M monthly downloads
  (https://registry.npmjs.org/@activepieces/pieces-framework).
- **Critical packaging detail**: `piece-slack@latest` has an **empty `dependencies` object and
  no `peerDependencies`** — framework/version coupling is enforced by the Activepieces engine
  at runtime, not by npm semver (https://registry.npmjs.org/@activepieces/piece-slack/latest).
  A host consuming pieces must supply compatible `pieces-framework`/`pieces-common`/`shared`
  itself.
- **Count**: activepieces.com/pieces claims "700+ Integrations" and renders "Showing 760
  pieces" (https://www.activepieces.com/pieces); the GitHub README lags at "200+"
  (https://github.com/activepieces/activepieces). npm fuzzy search returns 6,098 for
  `@activepieces/piece` but includes third-party scopes (e.g. `@attunesolutions/piece-yoke`,
  MIT, published Aug 2026) — third parties DO publish pieces under their own npm scopes
  (https://registry.npmjs.org/-/v1/search?text=%40activepieces%2Fpiece&size=3).
- **Cadence**: weekly platform releases; latest 0.88.3 on 2026-08-19
  (https://github.com/activepieces/activepieces/releases). Pieces publish continuously via CI:
  push to main touching `packages/pieces/**` triggers
  `.github/workflows/release-pieces.yml` → `publish-pieces-to-npm.ts` → metadata sync to
  Activepieces Cloud (https://github.com/activepieces/activepieces/blob/main/.github/workflows/release-pieces.yml).
- **Public metadata API — verified firsthand.** `https://cloud.activepieces.com/api/v1/pieces`
  returns unauthenticated JSON: array of pieces with `name` (`@activepieces/piece-*`),
  `displayName`, `version`, `logoUrl` (`cdn.activepieces.com/pieces/…`), `description`,
  `authors`, action/trigger counts, `pieceType: "OFFICIAL"`, `packageType: "REGISTRY"`, and the
  full auth schema. Docs also describe an authed "Install piece" endpoint
  (https://www.activepieces.com/docs/endpoints/pieces/install).
- **External use is undocumented.** The docs describe only: fork the repo, build with
  `createPiece`/`createAction`/`createTrigger`, publish to npm (community) or privately to your
  Activepieces platform. No doc describes running pieces in another engine
  (https://www.activepieces.com/docs/build-pieces/overview — note docs recently moved from
  `/docs/developers/` to `/docs/build-pieces/`; old paths 404).
- Repo: ~24k stars; `packages/pieces/` = `common`, `community`, `core`, `custom`, `framework`
  (https://api.github.com/repos/activepieces/activepieces/contents/packages/pieces).

## 2. Licensing

- **Dual license, directory-scoped.** Root LICENSE: everything under `packages/ee/` and
  `packages/server/api/src/app/ee` is licensed per `packages/ee/LICENSE`; "Content outside of
  the above mentioned directories … is available under the 'MIT Expat' license"
  (https://raw.githubusercontent.com/activepieces/activepieces/main/LICENSE).
- The enterprise license forbids production use without a paid subscription/seats; dev/test use
  is allowed (https://raw.githubusercontent.com/activepieces/activepieces/main/packages/ee/LICENSE).
- **Pieces and framework are MIT by location** (`packages/pieces/community/*`,
  `packages/pieces/framework` — both outside the ee dirs). **Caveat:** the published npm
  artifacts (`pieces-framework@0.32.0`, `piece-slack@0.17.9`) contain **no `license` field** in
  package.json, so MIT is inferred from repo location, not declared in npm metadata
  (https://unpkg.com/@activepieces/pieces-framework/package.json,
  https://unpkg.com/@activepieces/piece-slack/package.json).
- **Embed SDK is enterprise.** Source lives at `packages/ee/embed-sdk`
  (https://api.github.com/repos/activepieces/activepieces/contents/packages/ee); docs say
  "available in our paid editions" (https://www.activepieces.com/docs/embedding/overview);
  pricing lists an "Embed" plan **from $36k/year** (embeddable builder, branding, JS SDK, user
  provisioning) (https://www.activepieces.com/pricing).
- **Trademarks**: neither LICENSE mentions trademarks; no Activepieces brand-guidelines doc
  found. For third-party logos in a marketplace UI: Slack requires agreeing to its brand
  guidelines, non-standard uses need approval (https://slack.com/media-kit); Google routes
  brand use through its brand guidelines
  (https://partnermarketinghub.withgoogle.com/brands/google/overview/); nominative fair use
  permits using a mark only as needed to identify the service without implying endorsement
  (https://www.dmlp.org/legal-guide/using-trademarks-others).
- **Logo CDN**: pieces hardcode `logoUrl: 'https://cdn.activepieces.com/pieces/slack.png'`
  (https://raw.githubusercontent.com/activepieces/activepieces/main/packages/pieces/community/slack/src/index.ts).
  **No statement anywhere** on whether hotlinking that CDN is acceptable or stable — treat as
  unsupported; mirror the assets.
- **No CLA** in CONTRIBUTING.md; contributions land under the repo's dual license. Unsolicited
  external PRs are currently paused/auto-closed
  (https://raw.githubusercontent.com/activepieces/activepieces/main/CONTRIBUTING.md).

## 3. Prior art reusing pieces outside Activepieces

- **OpenOps** (FinOps automation): not a GitHub-native fork (fresh repo, 2025-03, ~1.1k stars)
  but Activepieces' architecture vendored wholesale — `packages/` = `blocks` (renamed pieces),
  `engine`, `server`, `shared`, `react-ui` (https://github.com/openops-cloud/openops/tree/main/packages).
  Relicensed Apache-2.0, **zero attribution** to Activepieces in README or LICENSE
  (https://raw.githubusercontent.com/openops-cloud/openops/main/LICENSE); root package.json has
  no `@activepieces/*` deps — copied, not imported
  (https://raw.githubusercontent.com/openops-cloud/openops/main/package.json). An OpenOps
  engineer files upstream issues
  (https://github.com/activepieces/activepieces/issues?q=author%3ArSnapkoOpenOps). Legal
  because the non-ee core is MIT.
- **ActiveBoxes**: "Fully open-source fork of ActivePieces with no enterprise edition code";
  loads pieces directly from the npm registry. Reported friction: had to write "polyfills of EE
  interfaces necessary to build the application … based on tests, DB migrations and/or code
  usage" — the open core is EE-coupled (https://github.com/activeboxes/activeboxes). Tiny (24
  stars).
- **ATOM**: "Hybrid Engine: Python orchestration + Node.js Piece Engine (ActivePieces
  catalog)" — the closest pieces-without-the-app precedent
  (https://github.com/rush86999/atom).
- **Orch8**: HN commenter integrated Activepieces "out of the box … 200+ connectors" into
  their own durable workflow engine
  (http://hn.algolia.com/api/v1/search?query=activepieces, item 48021431).
- Founder confirms pieces are shareable npm packages and "license is very permissive (MIT)"
  (HN comments, items 43901208 / 34764059 via hn.algolia.com).
- Activepieces repackaged ~280 pieces as MCP servers — the catalog reused as another surface
  (https://news.ycombinator.com/item?id=43556900).
- **Not found**: blog posts or GitHub discussions documenting running `@activepieces/piece-*`
  standalone; public complaints about framework API churn or piece versioning (absence of
  evidence, not evidence of absence).

## 4. Comparable products (embedded integrations)

- **n8n** — Catalog: ~500+ nodes maintained by n8n + unvetted community npm nodes. License:
  Sustainable Use License — "internal business purposes" only; distribution only "free of
  charge for non-commercial purposes"; explicitly forbidden: "white-labeling n8n and offering
  it to your customers for money" — commercial embedding requires the sales-led OEM/Embed
  agreement, and the embedder self-hosts ("runs in your infrastructure"); no managed OAuth
  apps (https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md,
  https://docs.n8n.io/privacy-and-security/sustainable-use-license, https://n8n.io/oem/).
  Community nodes "have full access to the machine that n8n runs on"; only a separate
  verified tier is reviewed (https://docs.n8n.io/integrations/community-nodes/risks/).
- **Zapier (Powered by Zapier / Workflow API)** — Catalog: ~9,000 apps, Zapier-maintained;
  execution hosted by Zapier. Strongest managed-auth story: Managed Authentication + Quick
  Account Creation silently creates a Zapier account and connections use **Zapier's own
  pre-registered OAuth apps** — the embedder registers nothing, but flows are Zapier-branded.
  Embed tools free to partners; requires a published Zapier App Directory listing; end users
  pay for their Zapier usage (https://docs.zapier.com/partner-solutions/getting-started,
  https://zapier.com/developer-platform).
- **Make** — "Make White Label" OEM: fully rebrandable Make instance (name, logos, theme,
  SSO/JWT) over Make's ~2,000-app catalog; sales-led contract, no public pricing; hosting and
  OAuth-app ownership not publicly documented
  (https://developers.make.com/white-label-documentation).
- **Tray (Tray.ai) Embedded** — 700+ Tray-maintained connectors + universal HTTP client;
  Tray cloud hosts execution; white-labeled config/auth UI with Tray managing token
  maintenance (own vs embedder OAuth clients not publicly documented); enterprise-tier,
  custom sales-led pricing (https://tray.ai/solutions/by-use-case/embedded-integration/).
- **Paragon** — embedded iPaaS, ~130+ native connectors; Paragon cloud or managed on-premise
  in your cloud; fully managed white-labeled auth portal but **BYO OAuth apps**: each
  integration guide has you create your own OAuth client; "Leaving the Client ID and Client
  Secret blank will use Paragon development keys" (dev only); Google verification is on the
  embedder's app (https://docs.useparagon.com/resources/integrations/gmail,
  https://docs.useparagon.com/resources/custom-integrations). Pricing sales-led.
- **Nango** — auth-first platform, Elastic License v2 (source-available; embedding in your
  product allowed, reselling Nango-as-a-service not; not OSI open source), auth/proxy for
  900+ APIs with provider configs in the open repo; free self-hostable, cloud from ~$50/mo
  per-connection (https://github.com/NangoHQ/nango, https://github.com/NangoHQ/nango/issues/900).
  Ships shared pre-registered "developer apps" for zero-setup testing; register your own
  before production (https://nango.dev/docs/implementation-guides/platform/auth/configure-integration).
- **Pipedream Connect** — managed auth + prebuilt tools for ~3,000 APIs, Pipedream cloud
  hosts execution; **Pipedream-managed OAuth clients** usable even in production for embedded
  tools and proxied requests (custom clients required to retrieve raw credentials or invoke
  workflows); free in development, production from $99/mo + per-user and credit-based usage
  (https://pipedream.com/docs/connect/, https://pipedream.com/docs/connect/managed-auth/oauth-clients).
- **Windmill** — core AGPLv3 (clients/API specs Apache-2.0), EE source-available; free for
  internal use, but re-exposing Windmill features in a product you sell requires a commercial
  license (white-label embedded builders are EE); Hub is community scripts, not vendor-managed
  connectors, no managed OAuth (https://github.com/windmill-labs/windmill,
  https://github.com/windmill-labs/windmill/discussions/3408, https://www.windmill.dev/pricing).
- **Temporal (DIY baseline)** — MIT durable-execution server + SDKs, self-host or
  consumption-priced cloud; no connector catalog, no OAuth management — every integration is
  an Activity you write and maintain forever (https://temporal.io/).

## 5. The managed-OAuth-app problem

- **Activepieces**: out of the box ALL instances use Activepieces' shared OAuth apps — users
  "see Activepieces as the app requesting access". Overriding with your own Client ID/Secret
  ("Override OAuth2 Apps", Platform Admin → Setup → Pieces) is a **paid platform feature**;
  stated reasons: branding, rate limits, compliance
  (https://www.activepieces.com/docs/admin-guide/guides/manage-oauth2). The community
  per-connection override was removed (https://github.com/activepieces/activepieces/issues/6265).
  Consequence for Carbon: consuming pieces outside their platform means NO access to their
  shared OAuth apps at all — Carbon registers its own apps per provider.
- **Google**: sensitive scopes ≈ 10 business days review; restricted scopes (Gmail/Drive)
  ≈ 6 weeks, "not guaranteed" (https://support.google.com/cloud/answer/13463817), plus an
  **annual CASA security assessment** (https://support.google.com/cloud/answer/13465431);
  lab fees roughly $540–$1,000+ (https://deepstrike.io/blog/google-casa-security-assessment-2025).
- **Slack**: unlisted public distribution needs no review — OAuth + SSL + "Activate Public
  Distribution"; Marketplace review only for a commercial listing
  (https://docs.slack.dev/app-management/distribution).
- **Nango**: shared developer apps exist but "most providers don't allow shared credentials —
  Nango developer apps may be revoked by the provider at any time"; consent screen says
  "Nango"; own app required to export tokens
  (https://nango.dev/docs/implementation-guides/platform/auth/configure-integration).
- **Paragon**: BYO credentials; dev keys for development only
  (https://docs.useparagon.com/resources/integrations/google-drive).
- **Pipedream**: managed OAuth clients usable, with capability and production-use limits
  (https://pipedream.com/docs/connect/managed-auth/oauth-clients).
- **Bottom line**: only Zapier and Pipedream offer vendor-managed, production-grade
  pre-registered OAuth clients; Nango's shared apps are dev-grade and Paragon manages the flow
  but expects your app. Shared apps carry vendor branding on consent screens, fixed scopes,
  provider-ToS/revocation risk, and lock-in. For Google restricted scopes there is no
  shortcut: your own verified app + annual CASA.

## 6. Security

- **Activepieces sandboxing** (`AP_EXECUTION_MODE`,
  https://www.activepieces.com/docs/install/architecture/sandboxing):
  | Mode | Tech | npm in code steps | Privileged container |
  |---|---|---|---|
  | UNSANDBOXED | `child_process.fork` | yes | no |
  | SANDBOX_CODE_ONLY | `isolated-vm` (V8) | no | no |
  | SANDBOX_PROCESS | `isolate` binary (kernel namespaces) | yes | yes |
  | SANDBOX_CODE_AND_PROCESS | both | no | yes |
  Their cloud runs SANDBOX_CODE_ONLY — "the only mode that is both multi-tenant-safe and runs
  as an unprivileged container". Note `isolated-vm` is in maintenance mode with the author's
  warning that secure isolation is "an extraordinarily difficult problem"
  (https://github.com/laverdet/isolated-vm). MicroVMs are only a proposal
  (https://github.com/activepieces/activepieces/issues/11547).
- **Advisories**: 9 published GHSAs (https://github.com/activepieces/activepieces/security/advisories),
  incl. Critical GHSA-m992-8rcw-vmrx (unauthenticated Bull-Board dashboard, Aug 2026) and three
  Highs that are exactly sandbox/tenant-isolation failures: cross-tenant code injection via the
  Code-piece sandbox cache (GHSA-5h2x-g6m3-grmq), RCE via command injection in a Code step name
  (GHSA-3pfv-m69p-5fv5), V8 isolate sandbox bypass via importFresh (GHSA-gr3h-c2j7-r52g); plus
  SSRF CVE-2026-12813 fixed in 0.84.0 (https://vuldb.com/cve/CVE-2026-12813).
- **npm supply chain**: event-stream 2018
  (https://snyk.io/blog/a-post-mortem-of-the-malicious-event-stream-backdoor/); polyfill.io
  2024, 100k+ sites (https://sansec.io/research/polyfill-supply-chain-attack); Sept 2025
  chalk/debug compromise + self-replicating **Shai-Hulud** worm across 500+ npm packages
  (https://unit42.paloaltonetworks.com/npm-supply-chain-attack/,
  https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem).
  Auto-tracking `latest` of hundreds of connector packages is the exposed posture.
- **Piece review**: in-repo pieces historically got maintainer review + CI auto-publish
  (https://www.activepieces.com/docs/developers/sharing-pieces/contribute), but CONTRIBUTING.md
  now auto-closes unsolicited external PRs and tells contributors to publish pieces as their
  own npm packages — externally published pieces receive **no** Activepieces review
  (https://raw.githubusercontent.com/activepieces/activepieces/main/CONTRIBUTING.md).
- Analogy: n8n community nodes "can do anything, including malicious actions"
  (https://docs.n8n.io/integrations/community-nodes/risks/).

## 7. Manufacturing-ERP precedent

- **Katana**: curated native connectors (Shopify, QuickBooks, Xero, HubSpot…) + Zapier + open
  API (https://katanamrp.com/integrations/).
- **Fulcrum**: native connectors + open API, implementation-led — "no integrations are truly
  plug-and-play" (https://www.fulcrumpro.com/integrations).
- **ECI JobBOSS2**: hand-picked partner integrations + public API
  (https://www.ecisolutions.com/products/jobboss2/features/integrations/).
- **Odoo**: integrations are individual apps — apps.odoo.com + OCA community modules
  (https://apps.odoo-community.org/); generic automation via Studio automation rules +
  webhooks (https://www.odoo.com/documentation/18.0/applications/studio/automated_actions/webhooks.html);
  long tail via Zapier (https://zapier.com/apps/odoo/integrations).
- **NetSuite**: SuiteApps marketplace + iPaaS partners (Celigo, Boomi, Workato)
  (https://www.houseblend.io/articles/netsuite-ipaas-celigo-boomi-workato-mulesoft).
- **No ERP/MES found embedding an open connector catalog** (three search angles). The
  capability exists only as commercial embedded iPaaS sold to SaaS vendors — e.g. Cyclr/Younium
  (https://cyclr.com/case-studies), Prismatic's embeddable marketplace
  (https://github.com/prismatic-io/embedded). Prismatic itself calls manufacturing ERPs "a
  nightmare to integrate" (https://prismatic.io/blog/why-many-manufacturing-erps-are-a-nightmare-to-integrate/).

## Implications for Carbon

| Approach | Pros (found) | Cons / risks (found) | Unknowns |
|---|---|---|---|
| **A. npm-per-piece import** (install `@activepieces/piece-*`, host the `pieces-framework` contract in Carbon's engine) | MIT; live npm publishing (weekly+); public metadata API for a catalog UI; precedent (ActiveBoxes loads pieces from npm; ATOM's piece engine; Orch8); no ee code needed | No official support for external use; pieces ship with empty deps — Carbon must pin and supply matching framework/shared versions; supply-chain exposure argues for pinned + reviewed upgrades, not `latest`; npm artifacts lack a license field (MIT by repo location only); logo CDN hotlinking unsupported — mirror assets | How much of the AP engine runtime pieces assume (store, files, auth props, pagination helpers) — needs a spike; framework API stability (no published guarantees) |
| **B. Vendored source / git subtree of `packages/pieces`** | MIT permits wholesale vendoring (OpenOps proves it, even relicensed); full review of every update; strip to the pieces Carbon wants; immune to npm-registry compromise of `latest` | Weekly upstream churn to merge; drift accumulates; still must build the host runtime; keep MIT notices (OpenOps' zero-attribution drew community criticism) | Long-term merge cost as upstream refactors (docs paths and package layout already shifted once) |
| **C. Activepieces engine as a sidecar** (their MIT engine executes pieces; Carbon orchestrates) | Least reimplementation of the piece contract; inherits their sandboxing modes | Engine ↔ server protocol undocumented for external callers; open core is EE-coupled (ActiveBoxes needed EE-interface polyfills); their sandbox record includes a V8 bypass and cross-tenant injection; namespace mode needs privileged containers | Whether the engine can run against a non-AP backend without carrying most of their server; upgrade lockstep between engine, framework, and pieces |
| **D. Official Embed SDK** | Fully supported; connections + builder UI managed by vendor | From $36k/yr; SDK is enterprise-licensed (`packages/ee/embed-sdk`); embeds THEIR builder via JWT/iframe — it does not feed Carbon's own engine, which defeats the premise | Contract terms (sales-led) |

Cross-cutting, regardless of approach:

1. **OAuth is the real cost center.** Outside their platform there is no access to
   Activepieces' shared OAuth apps. Carbon must register + verify its own OAuth clients per
   provider (Google restricted scopes: ~6 weeks + annual CASA), or layer a managed-auth vendor
   (Nango ELv2 self-hostable; Pipedream Connect managed clients) beneath MIT pieces. Slack-class
   providers are cheap (unlisted distribution, no review); Google-class are not.
2. **Treat pieces as third-party code, not a library.** Pin exact versions, vendor or mirror at
   install time, review diffs on upgrade, and execute in Carbon's existing job isolation — the
   Shai-Hulud incident and Activepieces' own advisories are the argument.
3. **Marketplace UI**: third-party logos are fine under nominative use if brand guidelines are
   followed; mirror piece logos rather than hotlinking `cdn.activepieces.com` (no stability
   commitment exists).
4. **Novelty check**: no surveyed ERP embeds an open connector catalog — this would be a
   differentiator, but there is also no ERP playbook to copy; the closest models are embedded
   iPaaS vendors (Paragon/Prismatic/Cyclr) whose economics assume they own the runtime.
