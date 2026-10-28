# CSV import wizard: column matches, one-row files, value codes

Branch: `fix/csv-import-mapping` (from `origin/main`).

Three bugs in the shared CSV import wizard (`apps/erp/app/components/ImportCSVModal/`),
one commit each. This branch does not touch the server-side import
(`importCsvTable`, `shared.service.ts`).

## 1. Column mapping drops exact matches when the AI runs

- [x] `FieldMappings.tsx` matches columns to fields by label or field name
  (case- and whitespace-insensitive), but only keeps those matches when **every**
  field matched. Otherwise it asks the AI route (`api+/ai+/csv+/$table.columns.tsx`)
  and rebuilds the mapping from `{}` out of the AI answer alone. Until the answer
  arrives every field is blank; if the request fails, every field stays blank.
- [x] Fix: set the exact matches as soon as the file is read. Ask the AI only when
  some field is still unmapped, and merge its answer so it only fills fields that
  have no column yet, with a column of the file that no mapping already uses. A
  suggestion never replaces or removes a mapping. The AI route is unchanged.
- [x] Pure helpers in `columnMatch.ts` (`matchColumnsExactly`,
  `mergeSuggestedColumns`), tested by `columnMatch.test.ts`, mirroring
  `enumMatch.ts` / `enumMatch.test.ts`.

## 2. A file with one data row is refused

- [x] `UploadCSV.tsx` refuses `rows.length < 2`, but `parseCsvFile`
  (`@carbon/files/csv`) parses with `header: true`, so `rows` already excludes the
  header. The check refuses a header plus one record with "at least 2 rows".
- [x] Fix: refuse only a file with no data rows, with a message that says so.
  Nothing downstream needs a second row (the mapping preview reads `firstRows.at(0)`;
  the server import has no minimum).
- [x] No committed test: the check is one comparison inside the upload handler, with
  no decision to extract. The proof is a scratch run of `parseCsv` on a header plus one
  record, which returns one row.
- [x] `pnpm lingui:extract` for the changed message.

## 3. Value mapping ignores codes

- [x] The value-mapping step auto-matches a CSV value against each option's label
  and aliases (`buildOptionLookup`, `enumMatch.ts`). Unit-of-measure fetchers return
  `{ name, id: code }` and the country fetcher `{ name, id: alpha2 }`, so the label is
  the name and the code is only the option's value. `EA`, `KG` or `US` match nothing
  and the row falls to the Default.
- [x] Fix in the shared matcher: after labels and aliases, key each option by its
  value too. Labels and aliases win over a value that collides with them. The change
  covers every fetcher keyed by a code, with no per-fetcher edit. For a fetcher keyed
  by a database id, the extra key only matches a CSV that holds that id.
- [x] Tests in `enumMatch.test.ts`.

## Docs

- [x] `.claude/rules/csv-import-system.md`: Frontend section, column and value matching.
- [x] `docs/content/docs/reference/import-export.mdx`: the Upload and Map columns
  steps, and the enum troubleshooting entry.

## Verification

- `pnpm --filter erp exec vitest run app/components/ImportCSVModal`
- `pnpm exec turbo run typecheck --filter=erp`
- `pnpm exec biome check <changed files>`
