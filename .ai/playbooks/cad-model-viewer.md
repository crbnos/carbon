# CAD Model Viewer (3D preview + optimise pipeline)

Last tested: 2026-07-23
Routes: /x/part/<itemId>/details (ERP), MES operation model tab
Artifacts API: /api/model/artifacts/<modelUploadId>

## IMPORTANT: the 3D render is NOT headless-testable

`agent-browser` runs headless with **no WebGL**. The viewer (`three.js`
`WebGLRenderer`, used by BOTH the server-GLB tier and the WASM raw tier) throws
`Error creating WebGL context`, and the route error boundary turns that into a
**500 page**. So you CANNOT verify the canvas render, the "Optimizing…" chip, or
the "Optimize failed · Retry" chip through agent-browser. Verify those in a real
GPU browser (Chrome MCP against the user's actual browser) or via user
screenshots.

What IS verifiable headlessly: the **artifacts API** (the data that drives the
viewer). Test that instead.

## Steps (artifacts-API verification — works headless)

### 1. Auth
Invoke /auth (logs in as test@carbon.ms → company "Carbon Development",
id d9h3of1gq0h02k8opfq0).

### 2. Find a model in the current company (dev DB)
```
PGPASSWORD=postgres psql -h 127.0.0.1 -p <PORT_DB from .env.local> -U postgres -d postgres -tA \
  -c 'select id,name,"optimizeStatus","modelPath" from "modelUpload" where "companyId"=<cid>;'
```
Seeded parts with models: BCU (item_RwMKW92n4qeA1Sr5Zf62BQ, model bH6N0l-qPCQE7A_Oz-FxE),
STEP_RAIL (item_FezKigf3vrRF2LYAmds2ro, model Y_bH9pzeJ0OrI9A5vHDiD). Both ~30 MB
`.step`, and (with no local assembler) settle `Failed` with the raw in temp-staging.

### 3. Fetch artifacts (return the promise — no top-level await in eval)
```
agent-browser eval "fetch('/api/model/artifacts/<modelUploadId>').then(r=>r.json())"
```
Verify the response shape: `optimizerAvailable` (bool), `optimizeStatus`,
`rawBucket` (probes `private` first, then `temp-staging`), `rawPath`
(null when the raw is pruned/gone), `optimizedModelPath`/`glbPath`.

### 4. What the fields imply for the viewer (verify visually in a real browser)
- `optimizerAvailable:false` → no auto-fire, no "Optimize failed · Retry" chip.
- `optimizeStatus:"Failed"` + `optimizerAvailable:true` + raw ≤50 MB → failed-retry
  chip shows over the WASM-rendered raw.
- `optimizedModelPath`/`glbPath` set → GLB renders (no raw tier, no chip).

## Prerequisites
- `crbn up` running (docker kong/edge/inngest for the branch + ERP app server).
- A local **assembler** is usually NOT running (no assembler docker container),
  so optimises settle `Failed` and the compact→private relocation can't be
  exercised locally. Storage relocation + jobs flow-control need a working
  assembler + Inngest-run/storage inspection, not browser automation.

## Common Failures
- Route 500 "Error creating WebGL context" → headless has no WebGL; expected, not a
  bug. Don't /error it.
- `await fetch(...)` in `agent-browser eval` → SyntaxError; return the promise chain instead.
- Empty psql result → wrong companyId (extract the `companyId` cookie cleanly).
