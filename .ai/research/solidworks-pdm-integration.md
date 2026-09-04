# SolidWorks PDM Integration — Research

> Date: 2026-08-04
> Purpose: ground the design of a Carbon ↔ SOLIDWORKS PDM Professional integration (spec: `.ai/specs/2026-08-04-solidworks-pdm-integration.md`), modeled on the existing Onshape integration.
> Grounded in the official SOLIDWORKS help (endpoint inventory extracted directly from the 2019–2026 `pdmprowebapihelp` doc trees), vendor/VAR documentation, and competitor connector marketing.

## TL;DR

- PDM Professional has **two APIs**: the classic in-process **COM API** (`IEdmVault5`, Windows-only, needs an installed PDM client + vault view + license) and an **HTTP REST "Web API"** (IIS app, PDM Professional only, JWT auth, default port 65453). The Web API is **read/write** (check-in/out, upload, data card save, state change) — not read-only.
- The Web API server component dates to ~2018 (built for EXALEAD OnePart indexing and eDrawings mobile vault access; integrated into the PDM installer in 2019); public endpoint documentation only appeared in the help around 2021–2022. Extraction of the doc tree counts **106 endpoints in the 2024 docs and 113 in 2025/2026**.
- **PDM 2025 added webhooks** (18 pre/post events incl. `OnPostChangeState`, i.e. "file released") plus server-side "add-in hook" DLLs — but as documented, each webhook is keyed to a *Web API HTTP request*, so events appear to fire for API-mediated operations; desktop-client-originated transitions are the norm in real vaults and are traditionally captured with COM add-ins/tasks/Dispatch or DB polling. Treat webhook coverage of desktop operations as **unverified — assume not covered** until tested.
- Every production ERP connector in this market (CADLink, Genius CAD2BOM, CustomTools, OdooPLM) is an **on-prem add-in or Windows service** that hooks PDM/CAD locally and pushes to the ERP. Nobody ships a pure "cloud calls the vault" integration. CADLink specifically = CAD/PDM UI add-in + background service watching workflow state changes, pushing Item/BOM/Routing to ERP on release.
- The realistic Carbon architecture is an **outbound-only on-prem agent** (Windows service using the COM API and/or localhost Web API) pushing to Carbon's REST API on release transitions, with the customer-exposed Web API as a secondary, lower-friction-but-lower-fidelity option for 2023+ installs.

---

## 1. API options

### 1.1 Classic COM API (`IEdmVault5` et al.)

- COM-based, stateful, in-process; interfaces like `IEdmVault5` (login/vault), `IEdmFile5`, `IEdmFolder5`, `IEdmEnumeratorVariable5` (data card variables), `IEdmBomMgr`/`IEdmBomView` (BOMs), `IEdmItem*` (items). "High-performance access to metadata, folders, variables, references, and workflow information," per Blue Byte's practical guide — explicitly *not* a REST API; it's tightly integrated with the Windows processes running the PDM client. https://bluebyte.biz/solidworks/solidworkspdm/a-practical-guide-to-the-solidworks-pdm-api-in-2026/
- Requires: Windows, the PDM Professional/Standard client installed, a local vault view, and a licensed vault login. Languages: VBA, C#, VB.NET, C++, PowerShell via COM interop (Python needs COM wrappers).
- Three application patterns: **add-ins** (DLLs registered in the vault, receive events via `IEdmAddIn5::OnCmd` — check-in, state change, etc.), **tasks** (framework for conversion/scripted work executed on a designated task host machine, triggerable from workflow transitions), and **standalone desktop utilities** (batch tools). https://www.codestack.net/solidworks-pdm-api/ and https://www.codestack.net/solidworks-pdm-api/pdm-tasks/
- This is the only API surface for **PDM Standard** (Standard's API is a restricted subset; no Web API at all).

### 1.2 SOLIDWORKS PDM Web API (REST) — PDM Professional only

- An optional **"Web API server"**: an ASP.NET web app hosted in IIS on-prem, installed from the PDM installer and configured per-vault in the Administration tool. Default HTTP port **65453**. Originally built so **EXALEAD OnePart** could index vault data (that's still how the admin help frames it) and to serve eDrawings mobile vault browsing; the 2019 release integrated its installation into the main PDM server installer ("previously, you had to install the Web API server components separately" — i.e. the component predates 2019). https://help.solidworks.com/2019/english/EnterprisePDM/Admin/c_web_api_server_overview.htm , https://help.solidworks.com/2019/english/WhatsNew/c_integrated_install_webapi_server.htm , https://help.solidworks.com/2022/english/EnterprisePDM/Admin/c_administering_web_api_servers.htm
- **Auth**: `POST /api/{vaultName}/authenticate` with `{Username, Password}` (a normal PDM vault user) returns a `JwtString`; subsequent calls use `Authorization: Bearer <token>`. Official docs include Python/C# samples. https://help.solidworks.com/2023/english/api/pdmprowebapihelp/PDM%20Pro%20API_ws~r-api-%7BvaultName%7D-authenticate~o-HttpPost.html
- **Not read-only.** The endpoint inventory (section 7) includes folder create, staged file upload + check-in, check-out/undo, data card variable save, workflow state change, and delete. Reads cover files, versions, references/where-used, configurations, variables, data cards, computed/named BOMs, search, workflows, users/groups, thumbnails, download.
- **Documentation quality is poor**: auto-generated, no OpenAPI/swagger published, no documented token TTL ("there is no way to determine when the access token expires" — Blue Byte), and SOLIDWORKS support has acknowledged the docs are auto-generated. https://bluebyte.biz/pdm-api-tips/a-quickstart-guide-with-the-solidworks-pdm-web-api/
- Community example front-end consuming the REST API: https://github.com/hawkwareapps/pdm-web-example (auth + search + PNG previews).

### 1.3 Web2 server

- **Web2 is a UI, not an API**: a responsive browser client (IIS app, typically `/SOLIDWORKSPDM` site) for browsing, searching, check-in/out, state change, and eDrawings-based WebGL preview from any device. It has no documented public API; the Web API server is the programmatic sibling. https://help.solidworks.com/2021/English/EnterprisePDM/FileExplorer/c_Web2_Client.htm , https://www.javelin-tech.com/blog/2025/09/using-the-solidworks-pdm-web2-client-for-external-access/ , https://hawkridgesys.com/blog/top-6-new-enhancements-in-solidworks-pdm-2019 (WebGL eDrawings preview added to Web2 in 2019).

---

## 2. Deployment reality — how cloud talks to an on-prem vault

PDM Professional is strictly on-prem: SQL Server (vault DB) + Archive Server (file store) + SolidNetWork License server, plus optional IIS boxes for Web2/Web API. Realistic patterns:

**(a) Customer exposes the Web API server** (internet or VPN): possible — Web2/Web API are explicitly designed to be internet-faceable via IIS with HTTPS — but requires the customer's IT to stand up IIS, TLS, firewall rules (port 65453 by default), and to accept a vault-credential-holding endpoint on the edge. VARs' guidance for Web2 external access applies equally. https://www.javelin-tech.com/blog/2025/09/using-the-solidworks-pdm-web2-client-for-external-access/

**(b) On-prem connector/agent** written against the COM API (or hitting the Web API on localhost), pushing outbound to the cloud ERP's REST API. This is what the entire commercial ecosystem does:

- **CADLink (QBuild)** — the market leader for SOLIDWORKS/PDM→ERP. Architecture per QBuild: three components — (1) a CAD-side interface "to check and compare ERP data before commit to PLM check-in," (2) a PLM/PDM data-card interface to browse ERP data and link PDM documents to ERP items, and (3) a **background service that monitors PDM workflow state changes** and auto-pushes Item, BOM, and Routing to the ERP when files hit designated (release) states. Bidirectional in the sense that engineers can *view/pull* ERP item-master data (descriptions, on-hand, open orders) from inside CAD/PDM, while the authoritative sync is a push into ERP. "No additional database or server components"; 50+ CAD/PDM/PLM sources, 50+ ERPs (Epicor, Dynamics 365 BC/F&O, SyteLine, JobBOSS, NetSuite, Acumatica, Plex, Rootstock…). https://www.qbuildsoftware.com/cadlink/cadlink-plm-pdm/ , https://www.solidworks.com/partner-product/cadlink-solidworks-pdm-professional , https://www.qbuildsoftware.com/wp-content/uploads/cadlink_fact-sheet_sw_2020.pdf , https://www.acumatica.com/acumatica-marketplace/qbuild-cadlink-cad-bom-to-acumatica-sync/
- **Genius ERP CAD2BOM** — "a plugin housed within your CAD system"; one-click conversion of the CAD model into an itemized BOM in Genius, creating items/raw materials in parallel; SOLIDWORKS/Inventor/CREO/Solid Edge/Catia. Same on-prem add-in pattern. https://www.geniuserp.com/features/cad2bom-engineering/ , https://www.solidworks.com/partner-product/genius-cad2bom
- **Odoo**: **OdooPLM** (open source, OmniaSolutions) uses a client-side CAD/PDM integration talking to Odoo over XML-RPC (https://github.com/OmniaGit/odooplm); **ATR CustomTools** is a SOLIDWORKS add-in syncing item master/BOM/documents to Odoo via remote calls (https://www.atrsoft.com/customtools/news/integrate-solidworks-with-odoo-erp/). ERPNext has no notable maintained connector.
- **JobBOSS / DDI System (Inform) / most mid-market ERPs**: served via CADLink rather than first-party connectors — QBuild lists them as supported targets.
- Historical pattern identical: SolidWorks Enterprise PDM → Dynamics AX connector (B&W IRS) was an on-prem service bridging the PDM database and AX. https://www.slideshare.net/slideshow/bwirs-solid-works-enterprise-pdm-microsoft-axconnector/17193515

**(c) Third-party middleware/iPaaS** — QBuild markets iPaaS targets, and xLM Solutions and Hawkware build custom PDM web-services bridges (https://www.youtube.com/watch?v=z46dW7d5Bg0 , https://github.com/hawkwareapps/pdm-web-example), but there is no established neutral "PDM cloud gateway" product category.

Conclusion: **(b) is the industry-proven pattern**; (a) became plausible for read-mostly integration once the Web API matured (and especially with 2025 webhooks), but no major ERP connector relies on it today.

---

## 3. Data model

- **Data card variables** are the metadata system of record: per-file (and per-folder) card values stored in the vault DB. Variables (e.g. `Number`, `Description`, `Revision`, `Material`) are **two-way mapped to file custom properties** via attribute mappings (block `CustomProperty`, attribute = property name) — edit the card and the SW file property updates, and vice versa. https://help.solidworks.com/2022/english/EnterprisePDM/admin/c_mapping_variables_solidworks.htm , https://www.javelin-tech.com/blog/2025/04/solidworks-pdm-how-to-map-variables-to-file-properties-and-custom-variables/ , https://www.goengineer.com/blog/solidworks-pdm-variable-mapping-tips-and-tricks
- **Per-configuration values**: if a SOLIDWORKS file has configurations, the data card shows one tab per configuration; values can differ per config (the `@` tab holds file-level/custom-tab values). The Web API mirrors this: `GET .../files/{fileId}/{version}/variables` returns an **array of `ConfigInfo`** ({ConfigurationName, ConfigurationId, Models:[{VarId, VarName, VarValue, VarType, VersionFree,…}]}) — i.e. variables grouped by configuration; `POST .../files/{fileId}/datacard` writes the same shape. https://www.goengineer.com/blog/configuration-properties-solidworks-pdm-data-cards
- **Revision**: a workflow concept — revision counters/numbers are bumped by workflow transition actions ("Inc. revision", "Set variable"), and the displayed revision is typically both a system attribute and a card variable stamped at release. Versions (every check-in) ≠ revisions (workflow-controlled). The API exposes file versions, history, and current state; the revision string is read from the card variable/file info.
- **BOMs**: two kinds.
  - **Computed BOMs (CBOMs)** — calculated live from the CAD assembly/drawing reference structure (includes virtual components, respects SW BOM exclusions; weldment cut lists are a computed type that only refreshes on check-in). Columns are admin-configured BOM views pulling card variables/referenced properties. https://www.mlc-cad.com/solidworks-help-center/how-to-activate-a-computed-bom-in-solidworks-pdm/ , https://help.solidworks.com/2021/english/EnterprisePDM/fileexplorer/c_Referenced_Properties_in_Computed_BOMs.htm
  - **Named BOMs** — a saved snapshot of a computed BOM that becomes a vault object in its own right: editable cell-by-cell, versioned, check-in/out, workflow states. This is what customers use as the "engineering BOM of record" when it must diverge from CAD structure. https://www.javelin-tech.com/blog/2018/08/solidworks-pdm-named-bom/
  - Web API surface: `GET .../files/{fileId}/bominfo` (which BOM sheets/types exist), `GET .../bom/{bomTypeId}/{fileId}/{version}/{folderId}/computed?configId=&latest=` (returns `ComputedBOM`: `Columns[]` + a recursive `BOMRef` tree of `BOMRow`s — **per-configuration via `configId`**), `.../named`, `.../weldmentcutlist`.
- **Item mode vs file mode**: PDM Professional has an item-centric layer ("Items" + Item Explorer — item numbers aggregating CAD + docs, item BOMs) but it is legacy/niche, administered separately, still documented through 2025 yet absent from the Web API; COM has `IEdmItem*`. The overwhelming majority of vaults are **file-mode** — part number lives on the file's data card. Plan for file mode; treat items as out of scope. https://help.solidworks.com/2023/English/EnterprisePDM/Admin/c_items_admin_tool.htm , https://help.solidworks.com/2025/english/EnterprisePDM/ItemExplorer/c_Item_Explorer.htm

---

## 4. Events / webhooks

- **PDM 2025+ Web API webhooks** ("web event hooks"): register URLs per event via `POST /api/{vaultName}/configuration/hooks/url` (or by editing `vault.config.json` under the Web API site root, e.g. `c:\inetpub\wwwroot\SOLIDWORKSPDM\WebApi`). **18 events**: pre/post × AddFolder, AddFiles, GetFile (download), LockFile (checkout), UndoLockFile, Checkin, **ChangeState**, DeleteFile, DeleteFolder. Payload includes event type enum, vault name, operation parameters; **pre-events can cancel the operation** by returning HTTP 402/412; per-vault `HooksTimeout` default 15 s; logs in `c:\ProgramData\SWPDMWebAPI`. Requires the admin's "Can administrate add-ins" permission. Also new in 2025: **server-side add-in hook DLLs** (`SWPDM.Hooks.IAddInHook::OnCmd`, uploaded via `PUT /configuration/hooks/dll`, loaded in isolated AppDomains — i.e. .NET Framework). https://help.solidworks.com/2025/english/api/pdmprowebapihelp/PDMProWebAPI_Webhooks_Programming_Guide.html , https://help.solidworks.com/2026/english/api/pdmprowebapihelp/Webhooks.html
- **Critical caveat**: the official event table maps each webhook to a specific *Web API HTTP request* ("If this webhook is configured… then when this HTTP request is sent…"). The hooks provider is a Web API server component, so as documented the webhooks fire for **operations performed through the Web API** — coverage of transitions performed from the desktop PDM client (the dominant path in real vaults) is not documented and should be assumed absent pending a live test. Do not architect around these webhooks without verifying that a desktop-client "Released" transition fires `OnPostChangeState`.
- **Pre-2025 / desktop-originated events** — the mechanisms real integrations use:
  - **COM add-in event hooks** (`IEdmAddIn5::OnCmd` for post-state-change, post-check-in, etc.) — fires in the client session performing the operation; this is how CADLink-class tools and serial-number/validation add-ins work. https://www.codestack.net/solidworks-pdm-api/
  - **Workflow transition actions**: "Execute task" (run a conversion/script on the task host at release), "Execute command", set-variable, inc-revision. https://help.solidworks.com/2021/English/EnterprisePDM/FileExplorer/c_Transition_Actions.htm , https://help.solidworks.com/2022/english/EnterprisePDM/admin/t_workflow_transition_actions.htm
  - **Dispatch** (admin-configured script actions on events) and **email notifications** on transitions (SMTP — some integrations literally parse notification mail).
  - **Polling**: query the vault (search API/COM, or read-only SQL against the vault DB — common but unsupported) for files that entered a target state since the last sweep. CADLink's "background service monitors state changes" is effectively this pattern.

---

## 5. Auth & licensing

- **License types** (SolidNetWork licenses): **CAD Editor & Web** (full, CAD add-ins), **Contributor & Web** (add/modify, no CAD add-ins), **Viewer** (read-only, cannot add/modify), plus **Processor Site License (PSL)**. https://trimech.com/solidworks-pdm-license-types-what-do-i-need/ , https://www.gsc-3d.com/blog/solidworks-pdm-license-types/
- **Web2** logins consume either a "Web" license (comes with each CAD Editor/Contributor/PSL) for read-write access or a Viewer license for read-only; license pools can be partitioned with an SNL options file. https://www.javelin-tech.com/blog/2019/01/solidworks-pdm-web2-login-type-options/ , https://support.hawkridgesys.com/hc/en-us/articles/115003426891-Managing-licenses-for-PDM-and-Web2-using-an-Options-File
- **Web API**: authentication is an ordinary vault user login; Dassault does not document a separate "API license," and license consumption semantics for Web API sessions are **not clearly documented anywhere** — plan on a dedicated service account holding an appropriate seat (Viewer if read-only suffices; Contributor if the integration writes card variables/states) and validate against the customer's SNL pool. A COM-based agent likewise consumes a client license while logged in. Budget one named seat per vault for the connector and confirm with the customer's VAR.

---

## 6. File previews

- **Web API**: `GET /api/{vaultName}/files/{fileId}/{version}/thumbnails?folderId=` returns a redirect (`Location` URI) to the thumbnail image — the community example renders PNG previews of SOLIDWORKS files this way. Simplest cloud-accessible preview path. https://github.com/hawkwareapps/pdm-web-example
- **COM**: the EPDM API has a documented "Get Preview Bitmap of File" pattern for the stored preview. https://help.solidworks.com/2018/english/api/epdmapi/get_bitmap_preview_of_file_example_vbnet.htm
- **Document Manager API** (headless, no SOLIDWORKS needed, free license key from Dassault): `ISwDMConfiguration9::GetPreviewPNGBitmapBytes` extracts the embedded per-configuration preview PNG straight from the `.sldprt/.sldasm` file. Ideal for an agent that already has file bytes. https://www.codestack.net/solidworks-document-manager-api/document/get-preview/
- **eDrawings**: interactive viewing — Web2 embeds the eDrawings WebGL viewer (since 2019; eDrawings viewer embedded in desktop preview tab since 2022). https://help.solidworks.com/2022/English/WhatsNew/c_wn2022_pdm_embed_edrawing_viewer.htm
- **Convert tasks**: the standard "publish at release" pattern — a PDM Convert task on the release transition generates PDF/STEP/DXF into the vault (runs on a task host with SOLIDWORKS installed); integrations then ship the neutral file to the ERP. https://www.codestack.net/solidworks-pdm-api/pdm-tasks/built-in-tasks/customizing-solidworks-pdm-convert-task/

---

## 7. Web API endpoint inventory (extracted from the 2026 docs; 113 endpoints)

Index: https://help.solidworks.com/2026/english/api/pdmprowebapihelp/PDMProAPI_ws.html (same for [2024](https://help.solidworks.com/2024/english/api/pdmprowebapihelp/PDMProAPI_ws.html), [2022](https://help.solidworks.com/2022/English/api/pdmprowebapihelp/PDMProAPI_ws.html)). Grouped, `{v}` = vaultName:

- **Auth/version/config**: `POST api/{v}/authenticate`; `GET api/version/webapi`; `GET api/configuration/vaults?vaultName=`; `GET|POST api/configuration/fileserverroot` (2025+); `GET api/{v}`, `GET api/{v}/info`
- **Search**: `GET|POST api/{v}/search` (returns bare `[{Id, Type}]`, Type: Folder=0 | File=1 | Bom=3 — you must follow up with info calls); `POST api/{v}/searchvariables` (variable-criteria search). https://help.solidworks.com/2024/english/api/pdmprowebapihelp/PDM%20Pro%20API_ws~r-api-%7BvaultName%7D-search~o-HttpGet.html
- **Folders**: `GET folders/{folderId}`, `/info`, `/browse` (children), `/datacard`; `POST folders/info` (bulk); `PUT folders/{parentFolderId}` (create); `DELETE folders/{folderId}?destroy=`
- **Files (read)**: `POST files/info` (bulk), `POST files/infofrompath`; `GET files/{fileId}/{version}` (+`/info`, `/info-extended`), `/history`, `/moves`, `/versions`, `/transitions`, `/configurations`, `/ActiveConfig`, `/variables` (per-config card values), `/datacard`, `/references?configId=`, `/allreferences`, `/whereused?configId=&anyVersion=`, `/download`, `/thumbnails`
- **Files (write)**: `POST files/CheckOut`, `files/UndoCheckOut`, `files/buildtree/checkout`, `files/buildtree/undo`; changeset flow: `GET changeset/create` → `PUT files/{changesetId}/upload` → `PUT files/{changesetId}/finishadd` / `PUT checkin/addfiles/{changesetId}` → `GET checkin/buildtree/{changesetId}` → `PUT checkin/{changesetId}/{overrideVersion}`; `POST files/{fileId}/datacard?folderId=` (save card variables, per-configuration payload); `DELETE files/{fileId}?destroy=`; `POST delete/computetree`; `PUT api/stage/{v}/{documentId}` (staging)
- **BOM**: `GET files/{fileId}/bominfo`; `GET bom/{bomTypeId}/{fileId}/{version}/{folderId}/computed?configId=&latest=`; `.../weldmentcutlist`; `GET bom/{bomDocumentId}/{version}/{folderId}/named`
- **Workflow/state**: `GET api/{v}/workflows`, `workflows/icons`; `GET state/{documentId}/transitions` (valid transitions for a file), `GET state/{transitionId}`, `GET state/{documentId}/{folderId}/{transitionId}/references`; `POST state/transitions` (bulk query); `POST state/{transitionId}/changestate?revoke=` (execute transition), `POST state/{transitionId}/HistoryComments`, `POST state/{transitionId}/DynamicNotificationUsers`
- **Users/groups**: `GET users`, `users/all`, `users/{userId}` (+`/info`, `/Extended` GET/PUT, `/Picture` GET/PUT/DELETE); `GET groups`, `groups/all`, `groups/{groupId}` (+`/info`)
- **Notifications**: `POST notifications`, `POST notifications/markRead`, `GET notifications?all=&pageNo=&pageSize=`
- **Async progress**: `GET progress/{guid}/status`, `GET progress/{guid}/result`
- **Hooks (2025+)**: `GET|POST configuration/hooks/url` (webhooks); `GET|PUT|DELETE configuration/hooks/dll` (add-in hook DLLs)

**Version history**: component ships ~2018 (EXALEAD OnePart / eDrawings mobile), installer-integrated 2019; endpoint docs published ~2021–2022; 2024 = 106 endpoints; **2025 = 113 (webhooks + add-in hooks + fileserverroot)**; 2026 unchanged vs 2025. The API is read/write throughout its documented life; growth has been incremental (Dassault's strategic investment is in 3DEXPERIENCE, not PDM).

---

## 8. Rate limits, pagination, gotchas

- **No documented rate limits** anywhere in the Web API docs. No documented pagination on search or browse — only the notifications endpoint has `pageNo`/`pageSize`. Large vaults ⇒ chunk queries yourself (per-folder browse, targeted search criteria).
- **Search returns only object IDs + types** — expect an N+1 pattern (search → bulk `files/info` POST → per-file `variables`/`bominfo`). Use the bulk `POST files/info` endpoint where possible.
- **JWT expiry is undocumented**; handle 401 by re-authenticating. https://bluebyte.biz/pdm-api-tips/a-quickstart-guide-with-the-solidworks-pdm-web-api/
- **`folderId` is required almost everywhere** (files can live in multiple folders via shared links); resolve and cache folder IDs.
- Default deployment is **HTTP on port 65453** — TLS is the customer's IIS problem; insist on HTTPS before any internet exposure.
- Docs are auto-generated with no OpenAPI spec; response models sometimes leak ASP.NET internals (`HttpResponseMessage` wrappers, redirect results). Budget for empirical testing against a live vault; SOLIDWORKS ships Postman collections in "Getting Started" (including `HooksManagement.postman_collection.json`).
- Webhook deliveries have a 15 s default timeout and no documented retry/signing — put a queue-backed receiver in front and verify payloads by calling back into the API.
- Version skew: features vary by customer's PDM year (webhooks need 2025+; many manufacturers run N-2). Vault schema/API is stable, but pin per-customer capability flags.

---

## 9. Onshape contrast & competitor sync direction

- **Onshape** is the cloud-native counterexample: full REST API for everything plus first-class **webhooks** (notifications on events such as a release), enabling genuine event-driven cloud↔cloud ERP integration with zero customer infrastructure. https://onshape-public.github.io/docs/api-intro/ , https://www.onshape.com/en/features/integrations
- Nothing in the PDM world matches that: PDM's 2025 webhooks still require an on-prem IIS Web API server that the customer must expose, and (per §4) appear scoped to API-mediated operations. The pragmatic PDM equivalent of "webhook on release" remains an on-prem hook (add-in/task/Dispatch/polling service) that pushes outbound.
- **Competitor positioning**: all major connectors (CADLink, CAD2BOM, CustomTools, OdooPLM) market "bidirectional," but functionally it decomposes to: **ERP→engineer lookup** (browse/validate item master, descriptions, inventory from inside CAD/PDM before commit) + **CAD→ERP authoritative push of item master + BOM (+ routings) triggered manually or on release-state transition**. The ERP never writes back into CAD geometry/BOM; at most it standardizes descriptions/part numbers on the card. That release-triggered one-way push is the industry-expected behavior Carbon should replicate.

---

## Implications for Carbon

Ranked architecture options for pulling item metadata, BOMs, revisions, and previews from customer PDM Professional vaults:

**1. On-prem connector agent (recommended primary, long-term).** A small Windows service the customer installs on a vault-connected machine (or the task host): logs into the vault (COM API via a local vault view, service account with Contributor/Viewer seat), detects release transitions (PDM add-in `OnCmd` post-state hook and/or periodic state-based search sweep — CADLink's exact pattern), then pushes outbound HTTPS to Carbon's API: card variables per configuration (part number, description, revision), computed/named BOM rows, thumbnail PNG (Document Manager `GetPreviewPNGBitmapBytes` or PDM preview bitmap), and released PDF/STEP produced by the customer's existing convert tasks. Pros: works on every PDM version incl. Standard (COM), no inbound firewall changes, event-fidelity for desktop-originated releases, matches what the market already trusts. Cons: Carbon ships/maintains a Windows .NET (Framework, COM-interop) installer — a real but well-understood engineering cost.

**2. Direct-to-Web-API integration (secondary / low-friction tier).** For PDM Professional 2022+ customers willing to expose (or VPN/tunnel) the Web API server: Carbon cloud authenticates as a service vault user and polls `search`/`state` for newly released files, then reads `variables`, `bom/.../computed|named`, `thumbnails`, `download`. On 2025+, additionally register webhooks (`configuration/hooks/url`) for `OnPostChangeState` as an acceleration signal — but keep polling as ground truth until webhook coverage of desktop transitions is proven on a live vault. Pros: zero installed software. Cons: customer must run/expose an optional IIS component over HTTPS, Professional-only, undocumented token TTL/limits, N+1 read patterns, weaker eventing.

**3. Hybrid (likely end-state).** Ship option 1's agent but implement its vault access against the *localhost* Web API where available (cleaner HTTP/JSON code path, COM fallback for Standard/older versions); agent handles eventing + outbound push, Carbon cloud handles mapping/UI. This maximizes shared code with option 2.

**4. Partner/middleware route (opportunistic).** Get Carbon listed as a CADLink-supported ERP target (QBuild integrates "any ERP"; Carbon's REST API is exactly what they consume) — instantly serves customers who already own CADLink, at zero engineering cost, in exchange for margin and no control of UX.

Cross-cutting product guidance: model the sync as **CAD→ERP one-way push on release** (create/update Carbon items, revisions, and an engineering BOM as a candidate for the manufacturing BOM), with read-only ERP-side lookups surfaced back to engineering later; key on the data card part-number variable per configuration (each SW configuration is potentially a distinct item); store the PDM fileId/configId/version as the external reference for idempotent upserts; ingest previews as thumbnails plus released PDF/STEP documents; and gate scope to file-mode vaults (ignore PDM "Items").
