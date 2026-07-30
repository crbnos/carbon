# Model Original Download (STEP/mesh raw bytes via api/model/download)

Last tested: 2026-07-28
Routes: `/api/model/download/:modelUploadId` (ERP + MES twins), `/file/preview/:bucket/*`

## What this verifies

Customers must always download the ORIGINAL uploaded bytes — never the
compacted `.xbf.zst` (OCCT container) or an error body saved as `.step`.

## Prerequisites

- Full stack: docker services + ERP dev server + assembler (`crbn up --all`);
  MES dev server too for the MES half.
- Logged in via /auth (test@carbon.ms, company `d9h3of1gq0h02k8opfq0`).
- A STEP fixture: `cargo test -p converter --test multibody_split` writes a
  valid ~32 KB STEP to `$TMPDIR/carbon-multibody-2/fixture.step` (hermetic,
  OCCT-generated). Binary STL is trivially synthesized with python struct.
- `shasum -a 256` the fixture BEFORE uploading — the whole test is hash equality.

## Steps

### 1. Upload without touching the (WebGL-only) viewer page
The part-details viewer 500s headless. Replicate the app's upload directly:
- PUT bytes: `POST http://127.0.0.1:$PORT_API/storage/v1/object/temp-staging/{companyId}/models/{modelId}.step` with service-role apikey+bearer.
- Register (authed browser): `fetch('/api/model/upload', {method:'POST', body: FormData{modelId, name, modelPath, size}})` → `{"success":true}` and model-optimize fires.

### 2. Wait for the pipeline
Poll psql (port `$PORT_DB`): `select "optimizeStatus","modelPath","originalPath" from "modelUpload" where id='...'`.
Expected (STEP, assembler on): `Success | {id}.xbf.zst | {id}.step` within ~10-60s.
Expected (STL): `Success | {id}.stl.zst | NULL` (zstd mode clears originalPath — the `.zst` IS the original).
Storage check: `select bucket_id,name from storage.objects where name like '%{id}%'` — all three (original, xbf.zst, optimized.glb) land in `private` when ≤50 MB.

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

## Observed numbers (2026-07-28)
- 32,572 B STEP → 1,153 B `.xbf.zst` + retained original (retention cost trivial).
- Full upload→optimize→compact pipeline settled in <10 s locally.
