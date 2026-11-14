# Feature run: Journal entry CSV import

- Date: 2026-11-14
- Mode: autonomous (dev queue). The build agent took each decision by the closest existing pattern and recorded it here.
- Request: a CSV import type for journal entries, one row per journal line, grouped by a journal reference. Each journal must balance and must post through the manual journal entry's path.
- Spec: `.ai/specs/2026-11-14-journal-entry-import.md`
- Plan: `.ai/plans/2026-11-14-journal-entry-import.md`
- Branch: `feat/journal-entry-import`, off `origin/main` at `b84fe506db`.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Draft or Posted | Status enum, default Draft | A new manual entry is a Draft. The form offers Save and Post. |
| Locked period | Accepted | `periodPostingRefusal(…, "accounting")` refuses only Closed, and a manual journal posts as `accounting`. |
| Closed period, Draft | Refused too | The import must not leave a Draft that cannot post. |
| Balance, Draft | Refused when unbalanced | The file is another system's books. |
| Dimensions | Three slots, the dimension as an enum Default | The wizard's fields are fixed per table. |
| Re-import | Skip a reference whose mapped journal exists | The import system's `externalIntegrationMapping` idempotency. |
| Amounts | Comma refused | The trial balance import's parser. |
| MCP / API | Not changed | `importCsvFile` has no `@mcp` tag. |

## Phase log

1. Research: `git log` on `imports.models.ts` showed the payroll totals import (#2003) and the opening stock imports (784666c528). A new type needs the 3 model maps, `importRequiresCreate` when it creates, the `importCsvInput` enum, one `importCsvTable` case and the list's `importCSV` prop.
2. Research: the manual journal entry reads in `accounting.server.ts` (`createJournalEntry`, `saveJournalEntry`) and `accounting.service.ts` (`saveJournalEntryWithLines`, `postJournalEntry`, `getOrCreateAccountingPeriod`). Lines carry no currency. Any active dimension of the group can tag a line.
3. Build: models, `journal-entry-import.ts`, the `importCsvTable` case and the table prop.
4. Tests: `shared.journal-entry-import.test.ts` covers row parsing, grouping, balance, an unknown account, Closed and Locked periods, the cutover, re-import and dimensions. `imports.models.test.ts` checks the new table's schema covers its fields.
5. Docs: `import-export.mdx` (new section, permissions, troubleshooting), `accounting.mdx` (one line), `csv-import-system.md`, accounting `AGENTS.md`.
6. Not done: a live run on a stack. This build had no stack.
