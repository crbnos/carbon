# Backups: bounded memory (stream table by table)

Branch: `refactor/backups-untangle`. Decided with the user 2026-11-10.

## Why

A 528k-row company peaked at 1.7 GB (export) and 2.3 GB (restore) locally.
Production runs these jobs in the ERP's Vercel function (`/api/inngest`, default
2 GB). Every stage held the whole company in memory: `readBackup` decoded every
table into `backup.data`, and the export held each table's rows twice.

## Design

- `CompanyBackup` = `{ manifest, rows(table) }`. `rows` downloads one table
  (`download().asStream()`), gunzips and parses it line by line, and yields
  batches, under today's table and column names. Called again, it reads again.
  Whether a table has rows comes from `manifest.tables[].rows`.
- `applyTableRenames` maps names in the manifest and wraps `rows` (no row copy).
- One scan pass (`scanBackup`) builds what the checks need, not the rows: ids per
  table, the distinct values (with counts) of each id-FK column, and the small
  `group` table. `findDanglingReferences`, `assertReferentiallyClosed`,
  `loadSubstrateIds` and `buildIdMaps` take that scan. Pure, as before.
- `insertTables` streams each table: batch → transform → insert chunks.
- Export reads each table through a cursor (`DECLARE … FETCH`), writes the rows
  into a gzip stream batch by batch, and uploads the compressed buffer. Format
  unchanged: old and new backups read the same.
- Import reads the few re-added tables in full (they are small config tables:
  `location`, …) to match colliding rows, and filters skipped rows while
  streaming.

Memory after: one batch per table in flight, the compressed table, and the scan
(ids and distinct FK values). A foreign restore also keeps the id map.

Not solved here: a restore is one transaction in one function call, so the
800 s limit still caps the largest companies.

## Revert removes the files its restore added

The restore records, in its marker, the target paths it wrote that did not
exist before it ran. Revert deletes exactly those, after the data is back.

## Tasks

- [x] format: `rows()` type, batched reader/writer, in-memory `backupFromRows`
- [x] storage: streaming `readBackup`
- [x] renames: rename manifest + wrap `rows`
- [x] remap: `scanBackup`; checks and id maps take the scan
- [x] load: streaming `insertTables`, `wipeAndLoad` takes the scan
- [x] restore / import / revert call sites
- [x] dump: cursor + streamed gzip
- [x] revert deletes added files
- [x] tests, typecheck, Biome, drift check
- [x] browser: big (memory), files, foreign, old schema
