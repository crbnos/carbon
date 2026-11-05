# Customer Portal (share link)

Last tested: 2026-11-05
Route: /share/customer/:id (signed out), /share/customer/:id/<storage path> (file download)

## Prerequisites
- Enterprise or Cloud edition (`CARBON_EDITION` in `.env`): community turns the portal off.
- The dev seed's ORBSEC Defense portal (`externalLink` with `documentType = 'Customer'`).
  Its orders show their SO number (no customer reference).
- Seed has one Needs Approval order for ORBSEC; make a Draft and a Cancelled one by
  updating two of its orders' `status` (put them back afterwards).
- For downloads: a `jobOperationStep` of type File on a root operation of one of the
  customer's jobs (seed: job J000001, second operation). Upload files to the company
  bucket (bucket id = companyId) at `<companyId>/job/<operationId>/<stepId>/<nanoid>/<name>`
  through `POST $SUPABASE_URL/storage/v1/object/<companyId>/<path>` with the service key,
  and insert `jobOperationStepRecord` rows whose `value` is that path.

## Steps
### 1. Share page
Open `/share/customer/<portalId>` signed out. Expect status 200.
- Draft, Needs Approval and Cancelled orders are absent.
- Due Date is the line's (or order's) promised date only: a line with only a requested
  date shows a blank Due Date.
- A line with no job shows "-" under Complete.
### 2. Attachments
Hover the Progress bar of a line with a job. The tooltip lists operations; a paperclip
appears only for recorded photos and PDFs, never a `.step` or other CAD file.
### 3. Downloads
GET `/share/customer/<portalId>/<recorded png path>` → 200 `image/png`.
Recorded `.step` → 404. A file in the operation folder with no step record → 404.
### 4. Gates
Customer status On Hold → page 404 and file 404; Active → 200.
`externalLink.expiresAt` in the past → 404; tomorrow or null → 200.
The ERP log shows `Customer portal refused: customerStatus` / `expired`, and
`refused a file type it does not serve` / `refused a file no step recorded`.

## Selector Notes
- Rows: `tbody tr` filtered by the SO number text.
- Progress tooltip: hover the first `div` in the row's last `td`; paperclip links are
  `a[href*="/job/"]` with the file name as `title`.

## Common Failures
- Signing in (needed for Sales → Portals) fails where `challenges.cloudflare.com` is
  unreachable: local dev always enables Turnstile with Cloudflare's test keys, and the
  bot check runs before the dev bypass. The share page and file route need no sign-in.
