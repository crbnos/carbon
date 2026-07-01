# Company Backup — Export & Download

Last tested: 2026-06-26
Route: `/x/settings/backups`

## Prerequisites
- Internal email session (`DEV_BYPASS_EMAIL` must be `@carbon.ms` / `@carbon.us.org`) — the page is `requireInternal`-gated; non-internal users get 404.
- Inngest dev process up (`PORT_INNGEST` in `.env.local`, default reachable at `http://localhost:<PORT_INNGEST>/`) — export is an Inngest job, not synchronous.

## Steps

### 1. Navigate
- URL: `/x/settings/backups`
- Expected: "Create backup" section (Label textbox + Include combobox), "Restore from a backup" section, and a "Backups" list ("No backups yet." when empty).

### 2. Create a backup
- Include combobox: "Data only" (default, fastest — no asset copy) or "Data + files".
- Button: "Create backup" (disables while the export job runs).
- A "Backup ready" dialog appears on completion (the list revalidates until the artifact lands — export has no status marker, so the UI diffs the list). Click "Done".

### 3. Download
- A "Download" link appears on the new backup row. Its href is `/api/settings/backup-archive/<name>`.
- The route re-tars the `exports/<name>/` storage folder on the fly: bounded parallel downloads (window 6) packed into a tar in order, outer gzip at level 1 (entries are already `*.ndjson.gz`), streamed to the browser. NOT a direct signed URL.

### 4. Verify (in-page fetch carries the auth cookie)
- `fetch(href)` → status 200, `content-type: application/gzip`, `content-disposition: attachment; filename="<name>.carbon.tar.gz"`.
- First two bytes are gzip magic `0x1f 0x8b`.
- Decompress with `DecompressionStream("gzip")`, walk 512-byte tar blocks: every entry has `ustar` magic at offset 257; expect `manifest.json` + one `tables/<table>.ndjson.gz` per non-empty table (Data-only). `assets/<path>` entries appear for "Data + files".

### 5. Delete (cleanup)
- "Delete" button on the row removes the gz + its `.assets/` folder; list returns to "No backups yet." No extra confirm dialog observed.

## Selector Notes
- The Include type is a combobox: click to open, options are "Data only" (selected by default) and "Data + files".
- Download is an `<a href*="backup-archive">` — fetch it in-page rather than relying on a browser download dialog.
- `agent-browser wait --load networkidle` TIMES OUT on these pages (dev HMR keeps sockets open) — use `sleep` + `agent-browser snapshot` instead.
- Modals (Backup ready / progress) capture the snapshot; use `agent-browser snapshot` (non-interactive) to read dialog text.

## Common Failures
- 404 on the page or download → session email isn't internal.
- "Backup ready" never appears → Inngest dev process not running (export job never executes).
- A Data-only export contains `searchIndexRegistry.ndjson.gz` — harmless (regenerable), not a bug.
