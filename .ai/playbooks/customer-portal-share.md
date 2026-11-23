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
`externalLink.expiresAt` in the past → page and file 404; tomorrow or null → 200.
The customer's status does not gate the portal.
The ERP log shows `Customer portal refused: expired`, and
`refused a file type it does not serve` / `refused a file no step recorded`.

### 5. Portal form (signed in, Sales → Portals)
Open `/x/sales/customer-portals/new` (a drawer).
- Customer: click the first combobox, pick the option by name (use a customer with no
  portal; the seed's Apex Space Research has none).
- Expires On: click the "month, Expires On" spinbutton and type the digits (`12012026`),
  then press Tab to commit. Check `input[name=expiresOn]` holds `YYYY-MM-DD`.
- Submit: `requestSubmit` the drawer form's Save button.
- A date today or earlier shows "Choose a day after today" under the field and saves nothing.
- A later date redirects to the list; the row shows the date. The stored instant is the
  start of that day in the company's timezone (seed company: America/Chicago, so
  Dec 1 is `06:00 UTC`).
- With `expiresAt` in the past (set in the database), the row shows an "Expired" badge.
- Edit (`/x/sales/customer-portals/<id>`) prefills the date; Backspace in each segment,
  Tab, Save stores `expiresAt` null.

## Selector Notes
- Rows: `tbody tr` filtered by the SO number text.
- Progress tooltip: hover the first `div` in the row's last `td`; paperclip links are
  `a[href*="/job/"]` with the file name as `title`.

## Common Failures
- Signing in (needed for Sales → Portals) fails where `challenges.cloudflare.com` is
  unreachable: local dev always enables Turnstile with Cloudflare's test keys, and the
  bot check runs before the dev bypass. The share page and file route need no sign-in.
- Behind an HTTPS proxy the dev server's Node `fetch` ignores `HTTPS_PROXY`, so the
  server-side Turnstile check fails with "Bot verification failed". Start the stack with
  `NODE_USE_ENV_PROXY=1`.
- Blurring the date field by clicking "Expires On" text hits the list's column header
  behind the drawer; press Tab instead.
