# Item Embedding Refresh

Last tested: 2026-09-30
Route: /x/part/<itemId>/details (Properties panel → Name → Edit)

## Prerequisites
- ERP dev server running (Inngest calls its `/api/inngest`), the worktree's Inngest container
  up, and the Vault secret `inngest_event_url` set (`crbn migrate` / `crbn up` write it).
- An active `EMBEDDING` `eventSystemSubscription` on `item` for the company.

## Steps
### 1. Record the current vector
`select name, md5(embedding::text) from item where id = '<itemId>'`
### 2. Rename
- Properties panel: the second "Edit" button (after the readable id's) opens the name input
  (`input[name=name]`). `fill` the new name, then blur it (`input.blur()` + click elsewhere) —
  Enter alone does not commit.
### 3. Verify (within ~5 s)
- `md5(embedding::text)` changed.
- Cosine of the stored vector vs `POST /functions/v1/embedding {"text":"<new name>"}` (service
  role) is 1.0 (item text = name + description).
- Inngest (`http://localhost:<inngest port>/v1/events?name=carbon/event-queue.process&limit=1`)
  shows the wake pushed by Postgres at the rename time.
### 4. Restore
- Rename back; the md5 returns to the original value exactly.

## Selector Notes
- Name input only exists while editing; re-snapshot after clicking Edit (refs shift).

## Common Failures
- No change: ERP dev server not running for this worktree (Inngest cannot reach the app), or
  `inngest_event_url` unset (`select decrypted_secret from vault.decrypted_secrets where name='inngest_event_url'`).
