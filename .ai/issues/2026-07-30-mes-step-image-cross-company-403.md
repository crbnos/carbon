# MES step reference images 403 (cross-company) + get-method annotations shape

Filed: 2026-07-30 · Found while fixing "BOP step images not showing on MES work instructions".
Status: OPEN (deferred — the rendering fix shipped separately in `Step.tsx`).

## Issue 1 (primary): file-preview 403 for cross-company operations

### Symptom
On prod, a shop-floor operator opens an MES operation and the step reference
images fail to load. The image request returns **403**:

```
GET https://mes.carbon.ms/file/preview/private/d0rlmp5l6de2s779lqi0/parts/<id>.png → 403
```
(referer: `/x/operation/jo_TGBpYrCw3oqQEGEjcbW9Qz`, active `companyId` cookie = `SMBHQP55H46bdEGV7acnir`.)

### Root cause
- The MES operation route loads via **service role**
  (`getCarbonServiceRole()`, `apps/mes/app/routes/x+/operation.$operationId.tsx`),
  so it renders an operation regardless of the session's active company.
- The slide image is stored under the operation's company:
  `private/<operationCompanyId>/parts/…` (path set at ERP upload time,
  `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` → `${companyId}/parts/...`;
  copied verbatim into `jobOperationStepSlide.imagePath` by the `get-method`
  edge function).
- The file-preview route authorizes **only against the session's active company**:

  `apps/mes/app/routes/file+/preview+/$bucket.$.tsx:82` (identical in ERP
  `apps/erp/app/routes/file+/preview+/$bucket.$.tsx`):
  ```ts
  const ownsPath =
    decodedPath.startsWith(`${companyId}/`) ||
    decodedPath.includes(`/${companyId}/`);
  if (!ownsPath) return new Response(null, { status: 403 });
  ```
- When the viewed operation's company ≠ the active-company cookie
  (`d0rlmp… ≠ SMBHQP…`, both companies the user belongs to), `ownsPath` is false → 403.
  Same-company files are unaffected — this only bites cross-company viewing, which
  the service-role operation page allows but the file route does not.

### Recommended fix (needs multi-tenancy sign-off)
Authorize the path against **every company the user is a member of**, not only the
active one. Membership helper already exists:
`getCompaniesForUser(client, userId)` → `string[]` (`packages/auth/src/services/users.ts`,
reads `userToCompany`). The user genuinely has permissions in that company, so
serving its private file is legitimate.

Sketch (both file-preview routes):
```ts
const { client, companyId, userId } = await requirePermissions(request, {});
const companies = new Set([companyId, ...(await getCompaniesForUser(client, userId))]);
const ownsPath = [...companies].some(
  (c) => decodedPath.startsWith(`${c}/`) || decodedPath.includes(`/${c}/`)
);
```
Keep the full-segment match (never `.includes(companyId)` loose) to preserve the
existing cross-tenant-substring protection.

### Alternative
Sync the MES active company to the operation's company when opening a
cross-company operation (root-cause, but touches company-switch/session flow;
`apps/mes/app/routes/x+/company.switch.$companyId.tsx`). Larger blast radius.

## Issue 2 (secondary): get-method stores slide annotations as `{}` not `[]`

`packages/database/supabase/functions/get-method/index.ts` copies method slides to
`jobOperationStepSlide` with `annotations: JSON.stringify(slide.annotations ?? [])`.
Observed result in the DB is a JSON **object** `{}` (`jsonb_typeof = object`), not an
array — so any consumer doing `annotations.map(...)` crashes.

- Reproduced locally: clicking a step image opened `ImageZoomViewer`, which does
  `annotations.map` → `500 "annotations.map is not a function"`.
- Worked around in the render fix (`Step.tsx` normalizes with `Array.isArray`), but
  the serialization in `get-method` (and possibly the source `slide.annotations`
  shape) should be corrected so job slides always persist an array. `AssemblyView`
  passes the same field to `ImageZoomViewer` and is likely latently exposed too.

## Related shipped change
`apps/mes/app/components/JobOperation/components/Step.tsx` — `StepsListItem` now
renders `jobOperationStepSlide` image slides (thumbnails + `ImageZoomViewer`),
mirroring `AssemblyView`. This makes the images *render*; Issue 1 is why they still
won't *load* for cross-company operations on prod.
