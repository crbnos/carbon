# SolidWorks Integration — Architecture Discovery

> Status: **v1 implemented** (Architecture A — local connector, outbound HTTPS). Discovery text below is retained.  
> Date: 2026-08-17  
> Author: lead-engineer inspection of the live Onshape → Carbon path + PDM Web API capability review  
> Related artifacts:
>
> - Research: `.ai/research/solidworks-pdm-integration.md`
> - Spec (draft): `.ai/specs/2026-08-04-solidworks-pdm-integration.md` — **cloud Web API direction; superseded for v1**
> - Connector: `apps/solidworks-connector/`
> - Test plan: `docs/solidworks-test-plan.md`
>
> This document is the execution-path map of **what exists today** for Onshape, plus how SolidWorks plugs into Carbon.

---

## v1 implementation status

**Shipped:** local connector + Carbon ingest. **Not shipped:** Carbon PDM picker, poll, webhook, PDF/STEP generation, SolidWorks add-in MSI.

| Piece | Location |
|-------|----------|
| Sync variant | `packages/database/supabase/functions/sync/index.ts` — `type: "solidworks"`, same row schema and tree builder as Onshape; mappings `solidworks` (root) / `solidworksData` (components) |
| Ingest | `POST /api/integrations/solidworks/send` — `carbon-key`, `parts_update` |
| Assets | `POST /api/integrations/solidworks/asset` — multipart `itemId` + `kind=pdf\|step`; `parts_update` + `documents_create` |
| Connector | `apps/solidworks-connector` — Node/TypeScript CLI (WinForms deferred; same `ISolidWorksSession` adapter). Live COM via optional `winax`; CI uses a fake session |

### Auth

Customer creates an API key in **Settings → API Keys** (company-scoped). Header: `carbon-key: crbn_…`.

Required scopes for this connector:

- `parts_update` — `POST /api/integrations/solidworks/send` and STEP attach
- `documents_create` — PDF attach on `POST /api/integrations/solidworks/asset`

Prefer a dedicated key with **only** those scopes. On Windows, connector settings store the key DPAPI-wrapped (CurrentUser). No OAuth / `defineIntegration` in v1.

### Property defaults

Tried in order; configuration-specific values override file-level. Override in connector `settings.json` → `propertyMaps`.

- Part number: `PartNumber`, `Number`, `Part Number`, `Part No`, `Base Item Number`
- Description: `Description`, `Description1`
- Revision: `Revision`, `Rev`

PDM data-card enrichment is a follow-up; customers who map card vars ↔ SW properties already get correct values.

### Asset rules

Discover existing files only (never generate): `{basename}.pdf` and `{basename}.step` / `.stp` in the component folder, then the assembly folder. Extensions and size caps align with Carbon `DOCUMENT_UPLOAD` / `CAD_MODEL_UPLOAD`. Paths must resolve under the assembly folder, the component folder, or `assetRules.allowedRoots`. Missing files warn; send still succeeds.

### Matching

`item.readableIdWithRevision` via `getReadableIdWithRevision` (Onshape `releaseKey`: `PN.rev`, omit revision `"0"`). Re-send updates the item and replaces make-method materials; mapping upserts.

### Limitations

- Requires a Windows machine with SolidWorks for live COM. Automated tests do **not** prove SolidWorks e2e (`docs/solidworks-test-plan.md`).
- Reads SolidWorks document custom properties, not PDM cards directly.
- No inbound listener; Carbon never calls the vault.
- Connector is a CLI, not a SolidWorks add-in menu (adapter is ready for that later).

---

## Architecture Decision

### Customer workflow under evaluation

Agreed v1 intent (as stated for this decision):

| Input | Value |
|-------|--------|
| CAD | SolidWorks |
| PDM | PDM **Professional** |
| OS | Windows |
| Trigger | **Manual “Send to Carbon”** (not auto-on-release) |
| Metadata | part number, description, revision |
| Structure | BOM |
| Assets | **existing** PDF + **existing** STEP (already in vault / beside the CAD file) |

### Can PDM Professional Web API satisfy this without a local desktop connector?

**Short answer: the Web API can supply the *data* Carbon needs, but it cannot by itself implement the customer’s *manual Send-to-Carbon* action inside SolidWorks/PDM.** For this customer’s stated workflow, **v1 should not be a pure cloud→PDM poll/mirror of Onshape Feature B.**

| Capability | Verdict | Evidence quality |
|------------|---------|------------------|
| Auth to vault | **Yes** | Verified (official + Blue Byte) |
| Read PN / description / revision | **Yes** (via data-card variables; names are vault-specific) | Verified endpoints; variable *names* customer-specific |
| Read computed BOM hierarchy | **Yes** | Verified endpoint inventory |
| Download file bytes (PDF/STEP) | **Yes** | Verified download endpoint exists |
| Find co-located PDF/STEP by same-folder/basename | **Possible to implement; not a first-class API** | Convention — **unverified** against this customer’s vault |
| Identify “released” state | **Partially** | State/transition endpoints exist; reliable “list everything in Released” via Web API search criteria — **unverified** |
| Put “Send to Carbon” in SolidWorks / PDM Explorer | **No** | Requires COM add-in, task, Dispatch, or other local UI |
| Fire reliably on desktop release without local hook | **Unverified / do not depend** | 2025+ webhooks appear scoped to Web API HTTP ops |

### Recommended architecture (v1)

**A — Local Windows / SolidWorks–PDM connector (outbound push), with Carbon receiving a CAD-sync payload over HTTPS.**

Shape:

```
Engineer in SolidWorks / PDM Explorer
  → manual "Send to Carbon" (add-in menu, task, or Dispatch)
  → local connector (COM and/or localhost Web API)
       reads: data-card vars, computed BOM, PDF, STEP
  → HTTPS POST to Carbon (authenticated company API / dedicated CAD ingest)
  → Carbon reuses Onshape persistence patterns:
       item match by readableIdWithRevision,
       sync edge / make-method tree,
       document + modelUpload + model-optimize
```

**Why this is the smallest clean *product* v1 for *this* customer (not the smallest Carbon-only diff):**

1. **Faithful to the requested trigger.** “Manual Send to Carbon” is a CAD/PDM-side action. The Web API has no UI surface in SolidWorks; Onshape-style Carbon pickers move the button into the ERP, which is a different product.
2. **No inbound vault exposure required.** Customer IT does not need to publish PDM Web API (port 65453 / IIS / TLS / firewall) to Carbon Cloud. Outbound HTTPS to Carbon matches every major PDM→ERP connector (CADLink et al.).
3. **Assets are already local to the vault view.** Existing PDF/STEP can be read from the vault without inventing remote co-location discovery as a correctness dependency on day one (still validate naming with the customer).
4. **Webhooks are not required.** Manual send is the ground truth; PDM 2025 webhook coverage of desktop transitions remains **unverified** and must not gate v1.
5. **Carbon backend stays Onshape-shaped.** Persistence, matching (`releaseKey`), `externalIntegrationMapping`, `document`/`modelUpload`, and `carbon/model-optimize` remain shared. What changes is the *ingress* (push from agent vs pull from OnshapeClient), not a parallel ERP domain model.
6. **Repo research already ranked this #1** for production fidelity (`.ai/research/solidworks-pdm-integration.md` Implications option 1). The draft Onshape-mirror spec chose cloud Web API for codebase parity; that choice is weaker once the customer workflow is explicitly **manual Send**, not auto release sync.

### Rejected alternative for this v1 (as primary)

**B — Pure PDM Professional Web API integration that Carbon cloud calls** (draft spec direction: poll + optional webhook + Carbon BoM picker mirroring Onshape).

Reject as *primary* for this customer because:

1. It does **not** deliver “Send to Carbon” inside SolidWorks/PDM without still shipping a local UI piece.
2. It forces **customer IT setup** (Web API server enabled, HTTPS, network path from Carbon to vault) before any engineer can use the feature.
3. Auto-poll / release sync is the wrong default for a **manual** workflow (over-sync, missed states between sweeps, search-by-state **unverified**).
4. Same-folder/basename PDF/STEP discovery over a remote API is convention-based and **unverified** on their vault; failures are silent.
5. JWT TTL undocumented; large-file downloads through Carbon jobs add operational risk vs local read + upload.

**When B becomes viable (or a tier-2 product):** customer accepts that “Send” means “in Carbon, pick a vault assembly and Sync” (Onshape Feature A UX) **and** will expose a reachable HTTPS Web API. Data-plane endpoints are sufficient for that mode (see investigation below). Do not block a future B on rejecting A.

### Hybrid note (not v1 unless needed)

A thin local “Send” button that only posts `{fileId, version, folderId}` and lets Carbon pull via a **customer-reachable** Web API still requires inbound vault access — it inherits B’s deployment pain while still shipping a Windows component. Prefer **local read + outbound push** unless the customer already exposes Web API.

### Assumptions (decision)

1. Engineers initiate sync manually from the Windows CAD/PDM environment.
2. Part number / description / revision live on PDM data cards (or mapped SolidWorks properties) and are readable via COM and/or Web API `variables`.
3. PDF and STEP already exist as vault files when the user sends (no Carbon-side SolidWorks translation).
4. Carbon Cloud remains the system of record for items/BOM after ingest; sync is one-way PDM/CAD → Carbon.
5. Customer can install a small Windows component on at least one vault-connected machine (engineer workstation or shared task host).
6. A dedicated PDM service/user license seat for the connector is acceptable (exact seat type **unverified** with Dassault docs — confirm with customer VAR).

### Unresolved blockers (must clear before coding)

| Blocker | Why it matters |
|---------|----------------|
| Exact “Send” UX surface | SolidWorks add-in vs PDM Explorer menu vs workflow task vs Dispatch — changes packaging |
| Auth contract into Carbon | API key / OAuth device / company token for the connector — not designed yet |
| Variable names | Confirm card variable names for Number / Description / Revision |
| PDF/STEP layout | Confirm same-folder + same-basename (or provide real paths/naming) |
| BOM type | Computed vs named BOM as customer SoR |
| Configuration policy | Active config only vs all configs |
| Live vault access for a spike | Without it, BOM column shapes and `files/info` state fields stay **unverified** at response-field granularity |
| Whether Web API is even installed | Optional IIS component; may be absent |

### Exact information we need from the customer

1. PDM Professional year/SP and whether **Web API server** is installed (even if unused for v1).
2. Where they want the button: SolidWorks, PDM File Explorer, both, or “from Carbon only is OK.”
3. Exact data-card variable names for part number, description, revision (screenshots of cards OK).
4. How PDF/STEP are produced and stored today (convert task? folder? naming pattern? example paths).
5. Example of one released assembly: part numbers, revisions, BOM depth, and sibling PDF/STEP filenames.
6. Computed BOM vs named BOM — which is the engineering BOM of record?
7. Multi-configuration parts: one Carbon item per file or per configuration?
8. Network constraints: can workstations reach Carbon HTTPS outbound? Is inbound to vault forbidden?
9. Who can install software (local admin / IT image)? Target machine (each CAD seat vs one task host)?
10. License seat available for a service/connector login.

---

## PDM Web API capability investigation (evidence-backed)

Sources used (no live vault in this session):

- In-repo: `.ai/research/solidworks-pdm-integration.md` (endpoint inventory from 2024–2026 `pdmprowebapihelp` trees)
- Blue Byte quickstart (auth + JWT TTL caveat): https://bluebyte.biz/pdm-api-tips/a-quickstart-guide-with-the-solidworks-pdm-web-api/
- Official help endpoint pages (auth, variables, download, computed BOM, webhooks index)
- Dassault SolidPractices “Getting Started with the SOLIDWORKS PDM API” (Web API overview; COM search `State` property — COM, not Web API)
- Official webhook programming guide URL exists for 2025/2026; full event-table body was **not reliably extractable** from the JS-rendered help page in this session — treat detailed webhook semantics as **research-cited, live-unverified**

Legend: **Verified** = documented endpoint/behavior with primary citation. **Unverified** = plausible but not proven on a live vault or not fully documented.

### 1. Authentication (relevant versions)

| Item | Status | Detail |
|------|--------|--------|
| Mechanism | **Verified** | `POST /api/{vaultName}/authenticate` with JSON `{ Username, Password }` → `JwtString`; subsequent calls `Authorization: Bearer <token>` |
| Availability | **Verified** | PDM **Professional** only; Web API is an optional IIS app (default port **65453**) |
| Token TTL | **Unverified / documented gap** | Blue Byte (citing API support): no way to know expiry; retry auth on 401 |
| Separate API license | **Unverified** | Auth is a normal vault user; seat consumption for Web API sessions not clearly documented by Dassault |

Relevant for any connector that talks HTTP to the vault (local or remote). Local COM login is a separate auth path (vault view + licensed client).

### 2. Endpoint coverage vs required domains

From the research inventory (2026 docs, 113 endpoints). Paths are under `/api/{vaultName}/…` unless noted.

| Domain | Documented endpoints (representative) | Enough for v1 data? |
|--------|--------------------------------------|---------------------|
| Files | `POST files/info`, `files/infofrompath`, `GET files/{fileId}/{version}` (+ `/info`, `/info-extended`), `/versions`, `/history`, `/download`, `/thumbnails`, `/configurations`, `/ActiveConfig` | **Yes** (field-level shapes **unverified** live) |
| Folders | `GET folders/{id}`, `/browse`, `/info`, `POST folders/info` | **Yes** |
| Versions | `/versions`, version path params on file routes | **Yes** |
| Revisions | No dedicated “revision object” API like Onshape; revision is typically a **data-card / workflow variable** | **Yes via variables** (name customer-specific) |
| Workflow state | `GET workflows`, `GET state/{documentId}/transitions`, `POST state/.../changestate`, file transitions routes | **Read current / available transitions: documented.** Enumerating “all Released files” via Web API search — **unverified** |
| BOM / references | `GET files/{fileId}/bominfo`; `GET bom/{bomTypeId}/{fileId}/{version}/{folderId}/computed?configId=&latest=`; `/named`; `/weldmentcutlist`; `GET .../references`, `/allreferences`, `/whereused` | **Computed BOM: yes.** Named BOM: yes but deferred. References ≠ convert PDF/STEP |
| Custom props / data card | `GET files/{fileId}/{version}/{folderId}/variables` → `ConfigInfo[]` with `VarName`/`VarValue`; datacard POST for writes | **Yes** for PN/description/revision **if** those variables exist |
| Associated files | No documented “get convert outputs for this part” API | Must use folder browse / search / naming convention — **convention unverified** |
| Download contents | `GET files/{fileId}/{version}/{folderId}/download` | **Yes** |
| Search / filter | `GET\|POST .../search` (returns `[{Id,Type}]` only); `POST .../searchvariables` | **Yes for picker.** State/date filter fidelity on Web API search — **unverified** |

### 3. Identifying a released file/revision reliably

| Approach | Status |
|----------|--------|
| Read current workflow state from file info / extended info | Endpoints **exist**; exact JSON field names for state/revision on `info` vs `info-extended` — **unverified** without live response capture |
| Filter search by workflow state | **Verified on COM** (`IEdmSearch5.State`). **Unverified** that Web API `search` criteria support the same |
| Treat “user clicked Send” as the release gate | **Reliable** for manual workflow — does not need automatic release detection |
| PDM 2025 `OnPostChangeState` webhook | **Do not depend for v1.** Documented feature; desktop-client coverage **unverified** (research: event table maps hooks to Web API HTTP requests) |

**Conclusion:** For **manual Send**, release identification is the user’s action. Automatic “only if Released” can be an optional local check once state fields are confirmed.

### 4. BOM / reference hierarchy for Carbon

| Source | Status |
|--------|--------|
| Computed BOM (`.../bom/.../computed?configId=`) | **Verified** endpoint; returns columns + recursive row tree per research. Column names are vault BOM-view config — **must normalize** like the draft spec |
| Named BOM | **Verified** endpoint; often the “BOM of record” in mature vaults — **ask customer** |
| `references` / `allreferences` | **Verified** endpoints; CAD reference structure, not a substitute for quantity/BOM columns |

Carbon needs indented quantity rows → same shape Onshape Feature A already persists. **Web API can provide this** if we normalize computed (or named) BOM. Live sample required before locking the normalizer.

### 5. Part number, description, revision, PDF, STEP

| Field / asset | How | Status |
|---------------|-----|--------|
| Part number | Data-card variable (e.g. often `Number`) via `/variables` | **Verified mechanism**; name **customer-specific** |
| Description | Data-card variable | Same |
| Revision | Data-card / workflow-stamped variable (not the same as file version integer) | Same; do not confuse PDM **version** (check-in counter) with **revision** |
| PDF | Download vault file bytes | **Verified download**; discovery of *which* file — **convention** |
| STEP | Download vault file bytes | Same |

Native `.sldprt`/`.sldasm`/`.slddrw` are not what Carbon’s viewer wants; customer already has neutral files — good.

### 6. Same-folder / basename PDF–STEP convention

| Claim | Status |
|-------|--------|
| “Convert tasks commonly write PDF/STEP beside the CAD file” | Industry practice (research §6) — **not a guarantee** for this customer |
| Web API can `browse` a folder and `download` matching names | **Verified** browse + download exist |
| This customer’s vault follows `Part.sldprt` ↔ `Part.pdf` ↔ `Part.step` | **Unverified — must confirm** |
| API links convert outputs as formal “children” of a CAD file | **Not documented** as such |

Local connector can also use filesystem/vault paths the engineer already sees, which is often easier to debug than remote basename inference.

### 7. How manual “Send to Carbon” works if Web API is SoR

If Carbon cloud + Web API were primary:

1. Customer exposes HTTPS Web API to Carbon (or VPN).
2. User opens **Carbon** (not SolidWorks) → SolidWorksPdmSync-like picker → search file → config → preview BOM → Sync.
3. Optionally attach PDF/STEP by folder browse + basename.
4. That is **manual**, but it is **Carbon-initiated**, not “Send from SolidWorks.”

To keep the button in SolidWorks while using Web API as SoR, you still need a **local** launcher that either pushes data or posts IDs for Carbon to pull — i.e. not pure B.

### 8. Trigger options (what the user would need)

| Mechanism | Fits manual Send? | Needed for recommended v1? |
|-----------|-------------------|----------------------------|
| Carbon polls PDM | No (automatic) | **No** |
| Local connector | **Yes** (CAD/PDM button) | **Yes** |
| Browser action in Carbon | Manual but ERP-side | Optional later / Onshape-parity tier |
| PDM 2025 webhook | Event-driven; desktop coverage **unverified** | **No** for v1 |
| Combination | Local send + optional future Web API picker | Reasonable roadmap |

### 9. PDM 2025+ webhooks

| Fact | Status |
|------|--------|
| Feature exists in 2025+ Web API (`configuration/hooks/url`, ChangeState among events) | **Verified** (help index / research extraction) |
| Timeouts, unsigned payloads, admin permission for hooks | Cited in research — treat as **documented but not re-validated** here |
| Fires for desktop File Explorer state changes | **Unverified — assume not** until live test |
| v1 dependency | **Forbidden** per this decision |

### 10. Architecture comparison

| Dimension | A Local connector → Carbon | B PDM Web API ← Carbon |
|-----------|----------------------------|-------------------------|
| Implementation complexity (Carbon) | Medium: new **inbound CAD ingest** API + reuse sync/attach; plus shipping a Windows app | Medium-High: full Onshape mirror (client, routes, jobs, poll, settings) entirely in monorepo |
| Implementation complexity (customer surface) | Windows installer / add-in | IIS Web API + TLS + firewall/VPN |
| Customer setup | Install connector; outbound HTTPS; vault login | Enable Web API; expose HTTPS; store vault password in Carbon |
| Security | Outbound-only; vault not on public internet | Inbound to vault; long-lived vault credentials in `companyIntegration` |
| Reliability | User-triggered; clear success/fail at click time | Depends on network path + poll/search correctness |
| Authentication | Connector → Carbon API auth; connector → vault (COM or local JWT) | Carbon → vault JWT; TTL undocumented |
| BOM access | COM BomMgr and/or local Web API computed BOM | Remote computed BOM (documented) |
| Asset access | Local vault files / paths | Remote download + basename discovery |
| Manual workflow | **Native fit** | Only if redefined as Carbon UI sync |
| Release workflow | Optional local state check; no webhook needed | Poll and/or unverified webhook |
| Deployment | Windows .NET/COM artifact to maintain | No desktop binary; harder networking |
| Maintenance | Two runtimes (TS + Windows) | One runtime; more brittle integration tests without vault |
| Likely failure modes | Install/COM bitness, license seat, offline machine | Firewall, TLS, 401 loops, silent missing PDF/STEP, empty search |

### Decision one-liner

**Build v1 as a local Windows “Send to Carbon” connector that pushes metadata + BOM + existing PDF/STEP into Carbon’s existing Onshape-like persistence path. Treat pure cloud PDM Web API as a later / alternate tier, not the primary answer to this customer’s workflow. Do not depend on PDM webhooks.**

---

## 1. Repository architecture (CAD-relevant slice)

Carbon is a pnpm + Turborepo monorepo. CAD integrations live in the **EE integrations registry**, not in a dedicated ERP module.

| Layer | Location | Role for CAD |
|-------|----------|--------------|
| Integration registry | `packages/ee/src/` | `defineIntegration()`, catalog UI config, OAuth/client install hooks, per-provider clients |
| Server lifecycle hooks | `packages/ee/src/hooks.server.ts` + per-integration `hooks.server.ts` | install / uninstall / healthcheck / webhook register |
| ERP API routes | `apps/erp/app/routes/api+/` | OAuth, pickers, sync POST, backfill, public webhooks |
| ERP UI | `apps/erp/app/components/`, `modules/items/ui/Item/BoMExplorer.tsx` | BOM picker widget, status badges |
| Privileged BOM persist | `packages/database/supabase/functions/sync/index.ts` | Edge function; discriminated union (`type: "onshape"` today) |
| Background jobs | `packages/jobs/src/inngest/functions/integrations/` | Release sync, backfill, attach helpers |
| Event contracts | `packages/lib/src/events.ts`, `packages/lib/src/trigger.ts` | Typed Inngest events + `trigger()` aliases |
| Model pipeline | `packages/jobs/.../tasks/model-optimize.ts`, `model-thumbnail.ts`, `model-compact.ts` | Raw CAD → viewer GLB / thumbnails (STEP **and** glTF supported here) |
| Persistence | `integration`, `companyIntegration`, `externalIntegrationMapping`, `item`/`part`, `makeMethod`/`methodMaterial`, `document`, `modelUpload`, storage buckets | **No Onshape-specific tables** |

**Principle:** one CAD provider = one `packages/ee/src/<id>/` package + thin ERP routes + optional Inngest jobs. Shared Carbon entities absorb the data. A SolidWorks connector must clone this shape, not invent parallel tables or a parallel sync service.

---

## 2. Existing Onshape flow (exact)

There are **two independent pipelines**. Both are one-way: Onshape → Carbon. Carbon never writes geometry or BOM back to Onshape.

### 2.1 Feature A — Manual BOM sync (creates/updates items)

```
BoMExplorer (item make-method)
  └─ OnshapeSync.tsx (if companyIntegration onshape active)
       │  load saved mapping: externalIntegrationMapping
       │    entityType=item, integration="onshape"
       │    metadata: { documentId, versionId, elementId }, lastSyncedAt
       │
       ├─ GET /api/integrations/onshape/documents
       ├─ GET /api/integrations/onshape/d/:did/versions
       ├─ GET /api/integrations/onshape/d/:did/v/:vid/elements   (assemblies)
       ├─ GET /api/integrations/onshape/d/:did/v/:vid/e/:eid/bom
       │     OnshapeClient.getBillOfMaterials(...)
       │     flatten headerIdToValue → rows
       │     join Carbon items by readableIdWithRevision
       │
       └─ POST /api/integrations/onshape/sync
             requirePermissions({ update: "parts" })
             onShapeDataValidator.parse(rows)
             serviceRole.functions.invoke("sync", {
               type: "onshape", makeMethodId, data, companyId, userId
             })
             upsert externalIntegrationMapping integration="onshape"
```

**Edge function** (`sync` case `"onshape"`):

1. Permission gate: `{ update: "resources" }` inside the edge function.
2. If target `makeMethod` is **Active** → reuse/create **Draft** version; optionally copy operations from Active.
3. Delete all `methodMaterial` for the target make-method.
4. Sort rows by dotted `index` (`"1"`, `"1.1"`, …); build tree; traverse:
   - Existing `id` → update item + replace `onshapeData` mapping.
   - No `id` → create `item` + `part` (type Part, UoM EA), create make-methods for assemblies, insert `methodMaterial`.
5. Upsert `externalIntegrationMapping` with `integration: "onshapeData"`, `externalId = readableIdWithRevision`, `metadata = raw Onshape row`.

### 2.2 Feature B — Release asset sync (link-only; never creates items)

**Connect:**

```
GET /api/integrations/onshape/install
  → oauth.onshape.com/oauth/authorize
    scopes: OAuth2Read + OAuth2Write
GET/loader integrations.onshape.oauth.ts
  → token exchange → companyIntegration.metadata
       { baseUrl, credentials{accessToken,refreshToken,expiresAt,type}, scope }
Settings: assetSyncEnabled=true
  → ensureOnshapeReleaseWebhook(companyId)
  → OnshapeClient.createWebhook(
       events: ["onshape.revision.created"],
       url: /api/webhook/onshape/:companyId
     )
```

**Go-forward (webhook):**

```
Onshape POST /api/webhook/onshape/:companyId
  gate: companyIntegration active + assetSyncEnabled
  event "onshape.revision.created"
    → trigger("onshape-revision-sync", {
         companyId, userId: installer, messageId,
         partNumber, documentId, versionId, elementId, elementType, revisionId?
       })
Inngest onshapeRevisionSyncFunction
  idempotency: event.data.messageId
  concurrency: elementId
  → runOnshapeRevisionSync:
       resolve revision LETTER via getRevisions
       match item:
         models: readableIdWithRevision = releaseKey(partNumber, revision)
         drawings (elementType 2): sharedNumberSuffix + same revision (ilike)
       export:
         Part Studio / Assembly → GLTF → attach → carbon/model-optimize
         Drawing → PDF → document row
       skip permanently on OnshapeAssetTooLargeError
```

**Backfill:**

```
POST /api/integrations/onshape/backfill  (gated on assetSyncEnabled)
  → trigger("onshape-backfill")
  → page company revisions → match → sync same attach path
  → skip if item already has modelUploadId / drawing PDF
```

### 2.3 What Onshape does **not** do

| Expectation | Reality in code |
|-------------|-----------------|
| STEP export | **Not used.** Client types: `OnshapeModelTranslationFormat = "GLTF"` only. Comment: multi-GB STEP assemblies; Onshape remains CAD SoR. |
| Automatic item creation on release | **No.** Asset sync is link-only. Items come from manual BOM sync (or manual ERP entry). |
| Signature-verified webhooks | **No.** URL secrecy + active integration + re-fetch from Onshape API. |
| Dedicated CAD tables | **No.** |

---

## 3. Exact Carbon data model

### 3.1 Integration catalog & credentials

| Table | Key | Contents |
|-------|-----|----------|
| `integration` | `id='onshape'` | JSON Schema for `companyIntegration.metadata` |
| `companyIntegration` | `(id, companyId)` | OAuth tokens, `assetSyncEnabled`, `onshapeCompanyId`, `scope`, `baseUrl` |

Metadata contract (post `20260703165330_onshape-asset-sync-jsonschema.sql`):

```json
{
  "baseUrl": "https://cad.onshape.com",
  "credentials": {
    "type": "oauth2",
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": "ISO-8601"
  },
  "assetSyncEnabled": false,
  "onshapeCompanyId": "...",
  "scope": "OAuth2Read OAuth2Write"
}
```

Validated by `verify_integration` when `active = true`.

### 3.2 External identity / mappings

Table: `externalIntegrationMapping`  
Unique: `(entityType, entityId, integration, companyId)`  
Optional unique external id: `(integration, externalId, entityType, companyId)` when `allowDuplicateExternalId = false`.

| `integration` value | Meaning |
|---------------------|---------|
| `"onshape"` | Root BOM mapping: `{ documentId, versionId, elementId }` + `lastSyncedAt` |
| `"onshapeData"` | Per-item raw Onshape BOM row metadata; `externalId` = `readableIdWithRevision` |

### 3.3 Items / BOM / assets

| Entity | Role |
|--------|------|
| `item` | Matched by `readableIdWithRevision` (= `readableId` or `readableId.revision` when revision ≠ `"0"`) |
| `part` | Created alongside new items in BOM sync (`id` = readableId) |
| `makeMethod` / `methodMaterial` | Make-method tree; Active→Draft versioning on sync |
| `document` | Drawing PDFs; path `{companyId}/parts/{itemId}/{name}`; upsert by `(companyId, path)` |
| `modelUpload` | Raw model in `temp-staging`; `item.modelUploadId`; assembler → viewer GLB |
| Storage | `private` (docs/thumbnails), `temp-staging` (raw models) |

Method-tree RPCs expose `item.externalId` / mapping-backed Onshape `State` for BOM explorer status badges (`20250527123150_onshape-status-bom-explorer.sql`).

---

## 4. Exact Carbon API contracts

### 4.1 ERP routes (Onshape)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/integrations/onshape/install` | settings | Start OAuth popup |
| loader | `/api/integrations/onshape/oauth` | settings | OAuth callback → store tokens |
| GET | `/api/integrations/onshape/documents` | session | Document picker |
| GET | `/api/integrations/onshape/d/:did/versions` | session | Version picker |
| GET | `/api/integrations/onshape/d/:did/v/:vid/elements` | session | Assembly elements |
| GET | `/api/integrations/onshape/d/:did/v/:vid/e/:eid/bom` | session | Normalized BOM preview |
| POST | `/api/integrations/onshape/sync` | `update: parts` | Invoke edge sync + root mapping |
| POST | `/api/integrations/onshape/backfill` | settings + `assetSyncEnabled` | Trigger backfill job |
| GET/POST | `/api/webhook/onshape/:companyId` | public + active integration | Webhook receiver |

### 4.2 BOM row shape (validator)

From `packages/ee/src/onshape/lib/data.ts` (`onShapeDataValidator`) — mirrored in the edge function:

```ts
{
  id?: string;                    // existing Carbon item id
  index: string;                  // "1", "1.1", ...
  readableId?: string;
  revision?: string;
  name: string;
  quantity: number;
  replenishmentSystem: "Buy" | "Make" | "Buy and Make";
  defaultMethodType: "Make to Order" | "Purchase to Order" | "Pull from Inventory";
  data: Record<string, any>;      // raw Onshape columns (incl. State)
}[]
```

### 4.3 Edge sync invoke body

```ts
{
  type: "onshape";
  makeMethodId: string;
  data: /* onShapeDataValidator */;
  companyId: string;
  userId: string;
}
```

### 4.4 Inngest events

```ts
"carbon/onshape-backfill": {
  companyId; userId; onshapeCompanyId?; after?; pageLimit?
}

"carbon/onshape-revision-sync": {
  companyId; userId; messageId; // idempotency
  partNumber; documentId; versionId; elementId;
  elementType: number; // 0 Part Studio, 1 Assembly, 2 Drawing
  revisionId?;
}
```

Aliases in `packages/lib/src/trigger.ts`: `"onshape-backfill"`, `"onshape-revision-sync"`.

### 4.5 Webhook envelope

```ts
{
  event: string;
  messageId?; documentId?; versionId?; elementId?;
  partNumber?; elementType?: number; revisionId?;
  // .passthrough() — extra fields allowed
}
```

Only `onshape.revision.created` dispatches work. `onshape.workflow.transition` is acknowledged and ignored.

---

## 5. Authentication

| Concern | Onshape behavior |
|---------|------------------|
| App credentials | Env: `ONSHAPE_CLIENT_ID`, `ONSHAPE_CLIENT_SECRET`, `ONSHAPE_OAUTH_REDIRECT_URL` |
| Integration visibility | `Onshape` `active: !!ONSHAPE_CLIENT_ID` in `config.tsx` |
| User connect | OAuth2 authorization code; popup via `onClientInstall` |
| Scopes | `OAuth2Read` + `OAuth2Write` (write required for translations + webhook admin) |
| Token storage | `companyIntegration.metadata.credentials` |
| Refresh | `getOnshapeClient` refreshes when `expiresAt` ≤ now; persists new tokens |
| Scope widening | Refresh **cannot** add write scope → reconnect required (`onshapeConnectionHasWriteScope`) |
| API auth | `Authorization: Bearer <accessToken>` against `https://cad.onshape.com` |
| Webhook auth | No HMAC; company URL + active + `assetSyncEnabled`; job re-queries Onshape |

---

## 6. BOM representation

**Onshape source:** indented multi-level assembly BOM  
`GET /api/v10/assemblies/d/{did}/v/{vid}/e/{eid}/bom?indented=true&multiLevel=true&generateIfAbsent=true&...`

**Carbon representation:** flat list with dotted `index` → tree in edge function → `methodMaterial` under parent `makeMethod`. Child assemblies get their own make-methods. Quantities and method types are user-editable in `OnshapeSync` before sync.

**Status UI:** `OnshapeStatus` reads Onshape `State` from mapping-backed `externalId` / `onshapeData` on method-tree nodes.

---

## 7. Asset / release flow

| Asset | Onshape path | Carbon landing |
|-------|--------------|----------------|
| 3D model | Translation → **GLTF** (stream to disk) | `temp-staging` → `modelUpload` → `carbon/model-optimize` → viewer GLB |
| Drawing | Translation → **PDF** | `document` under `{companyId}/parts/{itemId}/` |
| Thumbnail | `getElementThumbnail` PNG preferred | `modelUpload.thumbnailPath`; else `carbon/model-thumbnail` |
| STEP | Not exported from Onshape | N/A for Onshape (assembler **does** support STEP for other uploaders) |

Size caps via `getFileSizeLimit("CAD_MODEL_UPLOAD")` / `DOCUMENT_UPLOAD`. Oversized → `OnshapeAssetTooLargeError` → permanent skip.

---

## 8. Matching / idempotency

### Matching (`onshape-matching.ts`)

```ts
releaseKey(partNumber, revision)
// "PRT-002033" + "A" → "PRT-002033.A"
// revision "0" / empty / null → "PRT-002033"

sharedNumberSuffix("DRW-002033") // → "-002033" (drawing → model item)
escapeLikePattern(value)         // escape % _ \ for ILIKE
```

- Models: exact `item.readableIdWithRevision = releaseKey(...)`.
- Drawings: `ilike readableId %suffix` + same `revision`; 0 matches → skip; >1 → `ambiguous-item`.

### Idempotency mechanisms

| Mechanism | Where |
|-----------|--------|
| Inngest `idempotency: event.data.messageId` | revision-sync |
| Concurrency keys `elementId` / `companyId` | revision-sync / backfill |
| Document upsert by `(companyId, path)` | `upsertSyncedDocument` |
| Same `fileName` refresh of existing `modelUpload` | `attachOnshapeAssetsToItem` |
| Storage `upsert: true` | uploads |
| Backfill skip if model/PDF already present | `matchOnshapeBackfillPage` |
| BOM: delete all materials then rebuild; mapping upsert on conflict | `sync` edge |
| Webhook register skip if callback path already registered | `registerOnshapeWebhook` |

---

## 9. Reusable services (SolidWorks should share)

| Reuse as-is or clone-with-delta | Notes |
|---------------------------------|-------|
| `defineIntegration` + `IntegrationForm` / settings actions | Clone `onshape/config.tsx` |
| `companyIntegration` + `integration.jsonschema` seed | No new tables |
| `externalIntegrationMapping` two-mapping pattern | `"solidworks-pdm"` / `"solidworksPdmData"` (+ release class rows) |
| `releaseKey` / `sharedNumberSuffix` / `escapeLikePattern` | Same part-number contract |
| `sync` edge discriminated union | Add `type: "solidworks-pdm"`; reuse tree builder |
| `attachOnshapeAssetsToItem` **pattern** | Generalize or clone for STEP/PDF/thumbnail |
| `carbon/model-optimize` + `model-thumbnail` | Already accepts STEP |
| Webhook receiver shape | `webhook.onshape.$companyId.ts` |
| Inngest backfill/revision structure | Rate-limit retry, asset-sync gate, concurrency |
| `OnshapeSync.tsx` UX pattern | Picker → preview → Sync |
| Fixture playbook pattern | `.ai/playbooks/onshape-asset-sync.md` |

**Do not reuse as-is:** `OnshapeClient`, Onshape OAuth routes, GLTF translation API, Onshape webhook event names.

---

## 10. Proposed SolidWorks architecture

> **Superseded for v1 trigger/deployment by [Architecture Decision](#architecture-decision).**  
> The draft Onshape-mirror / cloud Web API design below remains a valid **tier-2** option if the customer accepts Carbon-UI “Send” + exposed Web API. Do not implement either path until customer answers in the Architecture Decision are collected.

### 10.1 Recommended v1 surface (local connector)

| Piece | Role |
|-------|------|
| Windows connector | Manual “Send to Carbon”; read PN/description/revision, BOM, PDF, STEP |
| Carbon ingest API | Authenticated push → reuse `sync` / matching / `document` / `modelUpload` / `model-optimize` |
| `externalIntegrationMapping` | Store PDM `fileId`/`version`/`configId` (and connector build id) for idempotency |
| Webhooks / Carbon→vault poll | **Out of v1** |

### 10.2 Tier-2 surface (cloud Web API — draft spec)

Integration id: **`solidworks-pdm`** (PDM Professional Web API, cloud-direct HTTPS) — see `.ai/specs/2026-08-04-solidworks-pdm-integration.md`.

| Feature | Onshape analog | SolidWorks delta |
|---------|----------------|------------------|
| A Manual BOM sync | `OnshapeSync` + `sync` type `onshape` | Vault file search → configuration → computed BOM → `type: "solidworks-pdm"` |
| B Release asset sync | webhook → revision-sync / backfill | **Cron poll**; PDM 2025+ webhook = optional hint only (**unverified** desktop coverage) |

### 10.3 Shared Carbon reuse (either architecture)

- Matching: `releaseKey` / `sharedNumberSuffix`
- Persistence: `item` / `makeMethod` / `methodMaterial` / `document` / `modelUpload`
- Model pipeline: STEP → `carbon/model-optimize` (already supported; Onshape uses GLTF)
- No new domain tables required for v1

### 10.4 Explicit non-goals for recommended v1

- Cloud poll of PDM as primary sync
- PDM webhook dependency
- PDM Standard (unless connector uses COM — possible later)
- Carbon → vault writes
- Generating PDF/STEP inside Carbon (customer already has them)

---

## 11. How the new integration should be tested

### 11.1 What exists today for Onshape

| Test | Coverage |
|------|----------|
| `packages/jobs/.../onshape-matching.test.ts` | **Only** automated unit tests — `releaseKey`, `sharedNumberSuffix`, `escapeLikePattern` |
| `.ai/playbooks/onshape-asset-sync.md` | Manual fixture + settings/webhook/backfill browser verification |

**Gaps (no automated tests):** `OnshapeClient`, attach, revision-sync, backfill, OAuth, webhook dispatch, `sync` edge `onshape` case.

### 11.2 Recommended SolidWorks test pyramid

1. **Unit (mandatory, CI)** — pure helpers first (red→green):
   - Matching: reuse/share `releaseKey` / `sharedNumberSuffix` tests.
   - BOM normalizer: reject zero/multiple part-number columns, bad quantities, inconsistent nesting **before** sync invoke.
   - Co-located file basename convention (`.step`/`.stp`/`.pdf`).
   - Idempotency skip (`version` ≤ recorded; model vs drawing mapping coexistence).
2. **Route / fixture (playbook, Onshape pattern)** — fake `companyIntegration` row matching jsonschema; settings toggle merge; backfill gating; webhook 400/200 contracts **without** trusting payload contents.
3. **Edge sync** — fixture payload proving `type: "solidworks-pdm"` builds the same make-method tree shape as Onshape for an equivalent indented BOM.
4. **Live vault (environment-gated)** — optional; document as blocked until a PDM Professional Web API fixture is available. Do not block merge of pure-logic + fixture paths on live vault access.
5. **Commands:**
   - `pnpm --filter @carbon/jobs test`
   - `pnpm --filter @carbon/ee test` / `typecheck`
   - `pnpm exec turbo run typecheck --filter=erp`
   - Browser: clone playbook for settings/webhook; `/test` for BOM widget when stack is up.

---

## 12. Unresolved questions

These remain open for product/engineering confirmation before or during implementation (spec resolved many autonomously — surface for veto):

1. **Live PDM Web API access** — no vault in-repo; endpoint response shapes for search/BOM/state filters still need empirical confirmation.
2. **Do desktop-originated “Released” transitions fire PDM 2025 webhooks?** — Research says assume **no**; polling is ground truth. Needs live proof.
3. **Can search filter by workflow state?** — Spec defaults to folder-sweep; `state-search` opt-in only after validation.
4. **Service-account license seat** — Viewer vs Contributor; consumption undocumented by Dassault.
5. **Convert-task naming conventions** — Spec fixes same-folder same-basename; real customers may diverge (configurable locations = v2).
6. **Generalize `attachOnshapeAssetsToItem` vs clone** — engineering choice; behavior must match (STEP vs GLTF input).
7. **Whether SolidWorks BOM rows should share `onShapeDataValidator` shape or a parallel zod schema** — Spec proposes `solidWorksPdmDataValidator` mapped into the same tree builder.
8. **Docs site publication** — User-facing CAD docs today: `docs/content/docs/integrations/cad.mdx` (Onshape-oriented). SolidWorks page TBD.

---

## 13. Assumptions

1. SolidWorks v1 means **SOLIDWORKS PDM Professional Web API**, not desktop COM, not PDM Standard, not 3DEXPERIENCE.
2. We mirror Onshape’s **two-feature** product (manual BOM + link-only release assets), not a third “auto-create items on release” path.
3. Part number + revision on the PDM data card map to Carbon `readableId` / `revision` / `readableIdWithRevision` the same way Onshape does.
4. Customers run release-time convert tasks producing STEP/PDF next to CAD files.
5. Credentials in `companyIntegration.metadata` plaintext is acceptable (same as Onshape tokens) until platform-wide secrets encryption.
6. Sync remains **PDM → Carbon only**.
7. Existing draft spec/plan are the implementation source of truth unless product vetoes cloud-direct in favor of an on-prem agent.

---

## 14. V1 scope

- Seed `solidworks-pdm` integration + settings (connection + asset sync toggle + backfill action).
- `SolidWorksPdmClient` + healthcheck / install connectivity.
- BOM picker widget in BoMExplorer + `sync` edge variant + mappings.
- Release poll cron + optional webhook acceleration + file-sync attach (thumbnail, STEP, PDF).
- Matching helpers + unit tests + fixture playbook.
- User docs delta when CAD docs are updated.

---

## 15. V2 ideas

- On-prem Windows agent (COM API) for PDM Standard + reliable desktop events (CADLink-class architecture).
- Named BOM support; per-configuration item expansion.
- Configurable convert-output paths / naming.
- Partner listing / CADLink-style marketplace path.
- Bidirectional card lookup (ERP descriptions/on-hand inside PDM) — competitors market this; not Onshape parity.
- Shared CAD attach module extracting Onshape-specific naming from jobs.
- Signed webhook verification if PDM adds it; encrypted integration secrets platform-wide.

---

## Appendix A — Files inspected (this discovery)

### Onshape EE
- `packages/ee/src/onshape/config.tsx`
- `packages/ee/src/onshape/hooks.server.ts`
- `packages/ee/src/onshape/lib/client.ts`
- `packages/ee/src/onshape/lib/data.ts`
- `packages/ee/src/onshape/lib/document.type.ts`
- `packages/ee/src/onshape/lib/element.type.ts`
- `packages/ee/src/onshape/lib/index.ts`
- `packages/ee/src/index.ts`, `packages/ee/src/hooks.server.ts`
- `packages/ee/AGENTS.md`

### ERP routes / UI
- `apps/erp/app/routes/api+/integrations.onshape.install.ts`
- `apps/erp/app/routes/api+/integrations.onshape.oauth.ts`
- `apps/erp/app/routes/api+/integrations.onshape.documents.ts`
- `apps/erp/app/routes/api+/integrations.onshape.d.$did.versions.ts`
- `apps/erp/app/routes/api+/integrations.onshape.d.$did.v.$vid.elements.ts`
- `apps/erp/app/routes/api+/integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts`
- `apps/erp/app/routes/api+/integrations.onshape.sync.ts`
- `apps/erp/app/routes/api+/integrations.onshape.backfill.ts`
- `apps/erp/app/routes/api+/webhook.onshape.$companyId.ts`
- `apps/erp/app/components/OnshapeSync.tsx`
- `apps/erp/app/modules/items/ui/Item/BoMExplorer.tsx` (mount point; referenced)
- `apps/erp/app/components/Icons.tsx` / BoMExplorer status (referenced)
- `apps/erp/app/utils/path.ts` (Onshape path helpers; referenced)

### Jobs / lib
- `packages/jobs/src/inngest/functions/integrations/onshape-matching.ts`
- `packages/jobs/src/inngest/functions/integrations/onshape-matching.test.ts`
- `packages/jobs/src/inngest/functions/integrations/onshape-attach.ts`
- `packages/jobs/src/inngest/functions/integrations/onshape-sync-element.ts` (referenced via revision-sync)
- `packages/jobs/src/inngest/functions/integrations/onshape-revision-sync.ts`
- `packages/jobs/src/inngest/functions/integrations/onshape-backfill.ts` (referenced)
- `packages/jobs/src/inngest/functions/tasks/model-optimize.ts`
- `packages/jobs/src/inngest/functions/tasks/model-thumbnail.ts`
- `packages/jobs/src/inngest/functions/tasks/model-compact.ts`
- `packages/lib/src/events.ts`, `packages/lib/src/trigger.ts`

### Database
- `packages/database/supabase/functions/sync/index.ts` (`onshape` case)
- `packages/database/supabase/migrations/20250410120243_onshape-integration.sql`
- `packages/database/supabase/migrations/20260214120000_update-onshape-jsonschema.sql`
- `packages/database/supabase/migrations/20260703165330_onshape-asset-sync-jsonschema.sql`
- `packages/database/supabase/migrations/20250527123150_onshape-status-bom-explorer.sql`
- `packages/database/supabase/migrations/20260128140000_external-integration-mapping.sql`

### Prior SolidWorks / CAD docs
- `.ai/research/solidworks-pdm-integration.md`
- `.ai/specs/2026-08-04-solidworks-pdm-integration.md`
- `.ai/plans/2026-08-04-solidworks-pdm-integration.md`
- `.ai/playbooks/onshape-asset-sync.md`
- `docs/content/docs/integrations/cad.mdx` (referenced)
- `.ai/research/3d-model-cad-capabilities.md` (referenced)

### Not present
- No `solidworks*` production implementation files under `packages/ee` or ERP routes.

---

## Appendix B — One-page Onshape execution flow

```
[Feature A — BOM]
User → OnshapeSync pickers → Onshape REST BOM
     → POST /api/integrations/onshape/sync
     → edge sync type=onshape
     → item/part/makeMethod/methodMaterial + onshape / onshapeData mappings

[Feature B — Release assets]
Onshape release → webhook /api/webhook/onshape/:companyId
               → Inngest carbon/onshape-revision-sync
               → match readableIdWithRevision (or drawing suffix)
               → GLTF/PDF export → attach → model-optimize / documents
               (backfill: carbon/onshape-backfill pages company revisions)
```

---

## Appendix C — Risks / blockers

| Risk / blocker | Severity | Notes |
|----------------|----------|-------|
| Customer “Send” UX / packaging undecided | **High** | Blocks connector design (add-in vs task vs Dispatch) |
| No live vault for response-shape proof | **High** | BOM columns, state fields, PDF/STEP layout remain partially unverified |
| Carbon ingest auth contract not designed | **High** | Required before local connector can push |
| Pure cloud Web API as primary for *this* manual workflow | **High (product mismatch)** | Rejected in Architecture Decision; draft spec still describes it as tier-2 |
| PDM webhook desktop coverage | Med | Unverified — **not a v1 dependency** |
| PDF/STEP naming convention | Med | Must confirm with customer; silent misses if wrong |
| Windows connector maintenance (COM/.NET) | Med | Real engineering cost; industry-standard tradeoff |
| If tier-2 Web API later: vault exposure + JWT TTL | Med | Documented gaps |

**Do not start full integration coding** until Architecture Decision customer questions are answered. Spike-only work (payload schema sketch, matching reuse) is OK after ingest auth direction is chosen.
