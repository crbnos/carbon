# Model Original Download (STEP/mesh raw bytes via api/model/download)

Last tested: 2026-10-17
Routes: `/api/model/download/:modelUploadId` (ERP + MES twins), `/file/preview/:bucket/*`

## What this verifies

Customers must always download the ORIGINAL uploaded bytes — never the
compacted `.xbf.zst` (OCCT container) or an error body saved as `.step`.

## Prerequisites

- Full stack with the assembler: `CARBON_DEV_APPS=erp,mes,assembler crbn up`.
  `.env.local` must have `ASSEMBLER_SERVICE_URL`; the ERP reads it only at start.
- Logged in via /auth with `agent-browser` (test@carbon.ms). The browser pane
  blocks every subresource of `*.service-functions.dev`, so the page never
  hydrates there.
- A STEP fixture: write a throwaway example in `crates/occt-bridge/examples/`
  that calls `occt_bridge::write_test_step(&path, 3)`, run it with
  `cargo run --release -q -p occt-bridge --example <name> -- <out.step>`, then
  delete the example. It writes a 48 KB, three-box STEP. A plain GLB:
  `cargo run --release -q -p converter --example convert_file -- in.step out.graph.json 0.5 out.glb`.
- `shasum -a 256` the fixture BEFORE uploading — the whole test is hash equality.

## Steps

### 1. Upload without touching the (WebGL-only) viewer page
The part-details viewer 500s headless. Replicate the app's upload directly:
- PUT bytes: `POST http://127.0.0.1:$PORT_API/storage/v1/object/temp-staging/{companyId}/models/{modelId}.step` with service-role apikey+bearer.
- Insert the `modelUpload` row (psql, or the authed `/api/model/upload`). The
  insert itself starts `model-optimize` (`queue_model_pipeline`); nothing else
  sends it.

### 2. Wait for the pipeline
Poll psql (port `$PORT_DB`): `select "optimizeStatus","modelPath","originalPath" from "modelUpload" where id='...'`.
Expected (STEP, assembler on): `Success | {id}.xbf.zst | {id}.step` within ~10-60s.
Expected (STL): `Success | {id}.stl.zst | NULL` (zstd mode clears originalPath — the `.zst` IS the original).
Storage check: `select bucket_id,name from storage.objects where name like '%{id}%'` — the original, the `.xbf.zst`, `optimized.glb` and the thumbnail land in the company bucket (bucket id = companyId) when ≤50 MB.
One assembler job does it all: the ERP log shows one `[optimize-{id}]` job and no `/v1/compact` or `/v1/thumbnail` call.

### 3. Download + byte-compare (in-browser, no file save needed)
```js
fetch('/api/model/download/{modelId}').then(r=>{window.__st=r.status;return r.arrayBuffer()})
  .then(b=>crypto.subtle.digest('SHA-256',b).then(h=>({status:window.__st,bytes:b.byteLength,
    sha256:[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')})))
```
PASS = status 200, sha256 equals the pre-upload fixture hash, content-type
`application/step` / `application/stl` (proxy decompresses `.zst` server-side).

### 4. Negative cases
- Legacy row (insert a modelUpload with `modelPath='....xbf.zst'`, null originalPath) → download route returns **404** (client shows toast, never saves bytes).
- `/file/preview/private/{companyId}/models/does-not-exist.step` → **404** (not 500).
- `/file/preview/private/<existing thumbnailPath>` → **200**: `private` is an alias for the caller's company bucket.
- A file staged under another company's prefix → **403**, through `private` and `temp-staging`.
- A `modelUpload` row whose `modelPath` names another company → optimise **Failed** ("Source file no longer exists"), nothing copied.

### 5. MES
Open `https://mes.<prefix>.dev/login` (portless host — cookies shared with ERP;
navigating to a raw `127.0.0.1:PORT` URL loses them). Repeat step 3/4 fetches.

## Selector Notes
- Login: fill email textbox, then `form.requestSubmit(submitButton)` — a click
  does nothing (ValidatedForm).
- No UI clicking needed for this test — it's all authed fetch + psql.

## Common Failures
- "User record not found" on login → docker stack partially down (postgrest/kong);
  `docker compose ... --project-directory . up -d` (MUST pass `--project-directory .`
  — compose volume paths are repo-root-relative; without it kong mounts a
  phantom directory and crashloops on `kong.yml: Is a directory`).
- MES fetch returns 200 + wrong hash (~33 KB) → you got the login page HTML;
  authenticate on the MES portless host first.
- `await` in agent-browser eval → SyntaxError; return promise chains.

## Observed numbers (2026-10-17)
- 48,285 B STEP → 1,264 B `.xbf.zst` + retained original, 4,880 B preview, 300×300 thumbnail.
- Insert → Success in about 2 s locally.
- The demo-dataset GLBs (`smallsat.glb` and others) fail the optimiser with `f32 oob`; the `optimize` crate fails on them too. Use a converter GLB.
