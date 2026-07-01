# Backups + Onboarding — Full Test Path

Covers: company export / import / revert (Backups), onboarding data-choice (demo / import / none) + Option C industry table, the schema-version guard, and the renamed-UI changes.

## Prerequisites (one-time setup per fresh DB)
- **Ownership**: Backups is owner-gated. After any `db:build`/reset, `companyGroup.ownerId` is NULL → set it:
  ```sql
  UPDATE "companyGroup" SET "ownerId" = (select id from "user" where email='test@carbon.ms');
  ```
- **Stack health**: export/import/revert run as Inngest jobs via edge functions. They need:
  - edge-runtime NOT CPU-saturated (`docker logs … edge-runtime` shows no "CPU time hard limit") — transient after rebuild, clears on its own.
  - edge→Inngest wired up — the edge-runtime container needs `INNGEST_DEV=1` + `INNGEST_BASE_URL=http://inngest:8288` in `docker-compose.dev.yml`'s `edge-runtime` service. Without it, edge fns 401 ("Event key not found") because their `inngest.send()` defaults to Inngest Cloud. (Fixed 2026-06-22 — see [[reference_edge_inngest_401]].)
- Use the `.dev` hostname (`ERP_URL`), not `localhost:<port>` — auth cookies/redirects are bound to the hostname.

---

## A. Backups — export → import → finalize / revert
Route: `/x/settings/backups`

1. **Page loads for owner** — nav + breadcrumb read "Backups"; "Create a backup", "Restore from a backup", "Backups" cards present. (Non-owner → redirected to settings with "Only the company owner can access backups".) ✅ verified live
2. **Export** — Label = "test", Files = "Data only" → *Create backup* → toast "Export started…". Wait ~10s, reload → a `*.carbon.json.gz` row appears under "Backups" with a size + Download/Delete.
   - Verify in DB: `select name from storage.objects where bucket_id='<companyId>' and name like 'exports/%'`.
3. **Export + files** — repeat with Files = "Data + uploaded files" (includeStorage=all) → larger artifact.
4. **Import (reseed)** — in "Restore from a backup", pick the backup, Mode = "Reseed", *Restore* → toast "Import started…". Wait → a "Pending restore" card appears with a run id + row count.
   - Verify: `select count(*) from "externalIntegrationMapping" where integration='company-template'` > 0 (the revert ledger).
5. **Revert** — on the pending run, *Revert* → toast "Revert started…". Wait, reload → pending card gone; ledger rows deleted; reseed-inserted rows removed.
6. **Import again → Finalize** — re-import, then *Finalize* → "Import finalized"; pending card clears; ledger deleted but inserted rows KEPT.
7. **Delete** — on a backup row, *Delete* → "Export deleted"; row gone from storage.
8. **Validation** — Restore with no file selected → "Select an export to import".

## B. Schema-version / "wrong schema" guard
The guard (`assertBackupImportable`) rejects an incompatible backup at import time with a specific reason.

1. **Out-of-date format** — export a backup, download it, then:
   ```bash
   gunzip -c backup.carbon.json.gz > b.json
   # set manifest.version to a wrong generation (current ARTIFACT_VERSION = 1)
   jq '.manifest.version = 999' b.json | gzip > bad.carbon.json.gz
   ```
   Upload `bad.carbon.json.gz` via "Restore from a backup" → *Restore* → import run fails with **"its format (generation 999) is no longer supported (current is 1)"**.
2. **Missing chart of accounts** — craft an artifact with `accountDefault` rows but empty `account` → rejected with "account defaults but no chart of accounts".
3. **Removed table / new required column** — only reproducible across a real breaking migration; the guard reports `table "X" no longer exists` or `"X" now requires column "Y", which this backup predates`. (Additive migrations stay compatible — no manual version bump.)

## C. Onboarding data choice + Option C industries
Route: `/onboarding/industry` (needs an **un-onboarded** user — the `test` user is already onboarded and redirects to `/x`; use a fresh user/company or reset onboarding state to exercise this).

1. **Data choice** — "Use demo data" / "Restore from a backup" / "I don't need data" all render. (The import option is now **always shown** — gating removed.)
2. **Industries come from the DB** (Option C) — the "Which best describes your company?" step lists the three `industry` rows (Robotics OEM, Precision Manufacturing, Motor Assembly) with bot/cog/wrench icons, fetched via `getIndustries`, not hardcoded.
   - Verify: `select id,name,"iconName" from industry order by "sortOrder"`.
3. **Demo** → pick an industry → submits `seedDemoData=true`, `industryId=<id>`; provisions from the published demo for that industry (or clean seed if none published).
4. **Custom** → leave industry unselected → `industryId` stored as **NULL** + `customIndustryDescription` free text (FK-safe).
5. **Import in onboarding** → choose "Restore from a backup", upload a `.carbon.json.gz` → identity-only seed + reseed import (chart of accounts comes from the artifact, no double-seed).

## D. Renamed / removed UI ("the changes I mentioned")
- ✅ "Backups" everywhere (nav, breadcrumb, headings) — renamed from data-management/"artifacts". verified live
- **No publish-demo in the UI** — the Backups page has export/import/finalize/revert/delete only; no "publish to catalog" control (the publish-demo + refresh-demo-catalog jobs were removed entirely).
- Demo-catalog copy: "Snapshot all of this company's data… Credentials, integration tokens and webhooks are never included."

## Live-verified (2026-06-22, after the edge→Inngest fix)
PASS: login, owner-gate, "Backups" terminology, **export** (job runs end-to-end → `*.carbon.json.gz` artifacts written, listed in UI with working signed Download URLs), **import pipeline** (no 401; reseed correctly rejected the already-seeded company → ledger=0, no pending run).
NOT YET RUN: a *successful* import → finalize/revert (needs a fresh company — the onboarding path, or a second empty company), and the version-guard tamper test (section B).
