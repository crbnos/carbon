# Accounting Sync Activity — daily consolidation retry, skip and re-send

Last tested: 2026-11-25
Route: /x/settings/integrations/xero → tab "Sync Activity"

## Prerequisites
- A Xero `companyIntegration` row for the signed-in company (fake OAuth credentials are fine;
  sync can stay off — Retry/Skip/Re-send only change ledger status).
- Posting sync settings with a source type on `daily-summary` granularity, two posted journals of
  that source type on mapped balance-sheet accounts, and their `journalEntry` push operations.
- Xero itself cannot be reached locally, so the consolidation runs outside the browser: a scratch
  vitest driver calls `consolidateIntegration` with `fetch` stubbed by a fake Xero whose journals
  persist in a JSON file between runs (seed with a create that answers 504 after storing).

## Steps
### 1. Navigate — open the Xero integration drawer, click the tab "Sync Activity <count>"
### 2. After the lost create — expect the `daily:xero:<date>` marker and both members Failed (504)
### 3. Skip the day — row `daily:xero:<date>`, button "Skip" → row reads Skipped, only "Retry" remains
### 4. Retry the members — each member row's "Retry" → Pending
### 5. Run the consolidation driver, reload, reopen the tab — members Completed (attempts 2) against
     the existing summary, marker still Skipped, the fake Xero still holds one journal
### 6. Retry the Skipped marker, run the driver — marker Completed as that summary, no new journal
### 7. Delete the summary in the fake Xero, "Re-send" one member, run the driver — that member is
     pushed on its own (a new journal), the other stays on the summary

## Selector Notes
- Row actions are buttons named "Retry", "Skip" and "Re-send" inside each row; find the row by its
  entity id text (`daily:xero:…`, `JE-…`), then the first matching button after it.
- The tab label includes the operation count ("Sync Activity 3"); match it by prefix.

## Common Failures
- Login on `http://localhost:<port>` does not stick: sign in on `ERP_URL` (the portless host).
- The first page load can render empty while Vite bundles dependencies; reload after a few seconds.
