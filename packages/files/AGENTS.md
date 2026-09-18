# @carbon/files

File handling, one subpath per file class. The goal is that "what is this file,
can we store it, what does it become, how do we serve it" has exactly ONE answer
in the codebase, shared by the browser, Node, and the Supabase edge runtime.

| Subpath | Provides |
|---------|----------|
| `.` (root) | Cross-type helpers: `MEDIA_CONTENT_TYPES` + `getContentType` (the one extension→MIME map every file-serving route uses), `getFileExtension` / `effectiveExtension` (`.zst` unwrap), `getDocumentType` / `documentTypes` / `isPreviewableDocumentType` (file classification for the Documents UI), `convertKbToString`, and `downloadBlob` / `downloadText` — THE browser "save this as a file" sequence (object URL → anchor click → revoke); never hand-roll it |
| `./csv` | `encodeCsv` (object rows) / `encodeCsvTable` (header + cells) — the ONE CSV encoder, injection-safe by construction (`stripCsvFormulaPrefix` on every string cell); `parseCsv` (text) / `parseCsvFile` (browser File, streamed); `downloadCsv`; `CSV_CONTENT_TYPE`. papaparse underneath, in every runtime. The Table export button, report exports, import templates, import-error re-exports and the sales CSV import all go through here — before this there were two libraries (`json-2-csv` + papaparse) and two hand-rolled encoders, and only ONE of the five export sites protected against formula injection |
| `./media` | Images. **`MediaUploader`** — the configured client (constructor takes the storage client + HEIC staging location once, files-sdk style): `prepareForUpload(files)` (HEIC → JPEG sequentially + duplicate-name refusal, throws `DuplicateFileNameError`), `convertHeic(file)`, `prepareImage(file, shape)`. Underneath: `processImage` (the pipeline), `prepareImageUpload` (pipeline → native-decode fallback → imgproxy fallback), `convertHeicToJpeg` / `convertHeicFiles` / `findDuplicateFileName`, `transformImageViaStorage` (imgproxy round-trip), `isHeic`, `IMAGE_UPLOAD_MIME_TYPES`, plus the storage-path helpers `getPrivateUrl` / `getRawModelUrl` / `parseJobFilePath` |
| `./media/node` | `initNodeImageCodecs()` — Node-only wasm pre-instantiation; call once before the pipeline in Node (jobs, paperless, vitest). Touches `node:fs`: never import from client code |
| `./cad` | CAD/model formats: `supportedModelTypes`, `optimizableModelFormat`, `modelPathOptimizeFormat`, `isModelRawDownloadable` |
| `./pdf` | PDF *reading* on [unpdf](https://github.com/unjs/unpdf): `extractPdfText` (`--- Page N ---` joined, what the AI extraction prompts consume), `extractPdfPages`, `getPdfPageCount`, `getPdfMeta`, and `openPdf`/`closePdf` for page-level work (the inspection overlay export and anchor crop drive pages themselves; `closePdf` destroys the loading task — `cleanup()` alone leaks the document transport). Generation stays in `@carbon/documents` — this is file handling, not templating |
| `./pdf/worker` | `registerReactPdfWorker(pdfjs)` — browser-only, synchronous; both app `entry.client.tsx` files call it once. Nothing else may set `GlobalWorkerOptions.workerSrc` |

## The image pipeline

The implementation lives in `packages/database/supabase/functions/shared/image-pipeline.ts`
(the edge runtime only mounts `supabase/functions/`); `./media/image.ts` re-exports it
by relative path — the same deliberate pattern as `@carbon/utils` `precision.ts`. Do
not "fix" that import and do not duplicate the code.

Codecs are wasm, lazy-loaded per format and identical in every runtime:
libheif-js (HEIC/HEIF decode), jSquash mozjpeg / png / webp (decode + encode),
jSquash resize. No ImageMagick anywhere. Node cannot load wasm over `fetch(file:)`,
hence `./media/node`. Bare specifiers resolve via `package.json` in Node/browser and
via `functions/deno.json` `imports` in Deno — add BOTH when adding a codec.

Shape modes (`ImageShapeOptions`): default = center-crop 300×300 (avatars),
`contained` = fit + 10% pad to 300×300 (item thumbnails), `height: n` = proportional
(logos, 128/512), `convert` = format normalization only (attachments). JPEG/HEIC/AVIF
sources re-encode as JPEG (alpha flattened onto white), everything else as PNG.

**HEIC is never stored.** Every upload chokepoint converts first, through
`MediaUploader`: both apps' `FileDropzone`, the ERP `useFileUpload` hook (the one
document-panel upload mutation — TanStack-shaped: options at the hook or per-call,
`onSuccess`/`onError`, `isUploading`; all ten document panels go through it, including `RecordDocuments` for supplier/customer records),
`useImageUpload` (ERP + MES editor hooks), Suggestion, slide uploads,
`DocumentCreateForm`, `AttachmentsList`, the three curated forms
(`ItemThumbnailUpload`, `ProfilePhotoForm`, `CompanyLogoForm`). Non-browser callers
(REST/MCP/integrations) use the `process-image` edge function, which runs the same
`processImage`; the MCP signed-URL flow (`createDocumentUploadUrl` in
`documents.service`, which every module's `create*DocumentUploadUrl` delegates to)
mints a `.heic` name into `{companyId}/tmp/uploads/…` staging, and
`insertUploadedDocument` converts it to JPEG (imgproxy round-trip — the bytes
are already in storage) at the real path before the row exists; the nightly
cleanup job sweeps everything under `{companyId}/tmp/` older than a day. Temp staging for the imgproxy
fallback is `private/{companyId}/tmp/`.

Fallback order in `prepareImageUpload`: wasm pipeline → (browser only) native
`createImageBitmap` decode for formats the pipeline lacks (gif, avif) → imgproxy
storage round-trip. On the edge function, `MAX_PIXELS` (25MP) guards the wasm decode
(it materialises the full RGBA frame — ~200MB for a 48MP iPhone photo); over that
it falls back to imgproxy, which decodes natively in bounded memory.

Adding a file class: create `src/<type>/` with an `index.ts`, add the `./<type>`
export to `package.json`, and add a row above. Don't pre-create empty slots — `json`,
`text` etc. get a subpath the day something needs unifying, not before.

## Always

- Export/download through `encodeCsv` + `downloadCsv` (or `downloadBlob`); never
  string-join cells or build a `<a download>` inline.
- Add a new ERP document-panel upload via the `useFileUpload` hook; anywhere else,
  run picked files through `MediaUploader.prepareForUpload` first — never upload a
  picked `File` raw.
- Serve files with `getContentType(effectiveExtension(path))` — never a local
  MIME map.
- Read PDFs through `./pdf` only. Never import `pdfjs-dist` or `pdfjs` from
  `react-pdf` at a call site — `react-pdf`'s `<Document>`/`<Page>` are the only
  things app code takes from that package.

## One PDF.js engine per bundle

`react-pdf` hard-imports `pdfjs-dist` (5.4) and unpdf ships its own serverless
build (6.1, worker inlined). Two engines in one browser bundle means two workers
and ~2 MB of duplicate code, so `./pdf` resolves the engine per runtime:

| Runtime | Engine | Worker |
|---|---|---|
| Browser | react-pdf's `pdfjs-dist`, via `definePDFJSModule(() => import("pdfjs-dist"))` — the bundler dedupes to one copy | `registerReactPdfWorker` in `entry.client` |
| Node / edge / jobs | unpdf's inlined serverless build | built in — no worker file, no `@ts-ignore` legacy imports (the old `extract-document` hack) |

unpdf still carries `import("unpdf/pdfjs")` as a never-reached fallback, which
Vite emitted as a 1.5 MB lazy chunk in every deploy. Both apps alias
`unpdf/pdfjs` to `app/ssr-shims/unpdf-pdfjs-stub.mjs` to keep it out; the ERP
client build was verified to contain exactly ONE engine chunk (388 KB). Any new
app that consumes `./pdf` in the browser needs the same alias.
- Classify with `getDocumentType`; narrow to preview-capable with
  `isPreviewableDocumentType` (a `@ts-expect-error` on a `DocumentPreview` `type`
  prop means a missing narrow, not a type bug).

## Never

- Import `./media/node` from anything that can reach the browser bundle.
- Store a `.heic`/`.heif` object. The preview routes' read-time transform is a
  safety net for legacy/API-stored files, not a licence to skip conversion.
- Expose imgproxy outside the Docker network — it reads the storage volume with
  no RLS.

## Validation

```bash
pnpm --filter @carbon/files test        # vitest (includes a real HEIC fixture)
pnpm --filter @carbon/files typecheck
cd packages/database/supabase/functions && deno check --no-lock shared/image-pipeline.ts
```

## Cross-References

- `packages/database/supabase/functions/process-image/` — the authed server entry
- `packages/database/supabase/functions/logo-resizer/`, `thumbnail/` — consumers of
  the pipeline primitives (`decodeImage` / `resizeImage` / `encodeImage`)
- `packages/dev/docker/docker-compose.dev.yml`,
  `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml` — imgproxy service
- `apps/{erp,mes}/app/routes/file+/preview+/$bucket.$.tsx` — read-side serving
