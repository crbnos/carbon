# Aging report detail fields

- [x] Extend AR/AP open-document RPC results with transaction date and signed original base amount; regenerate database types.
- [x] Show transaction date, type, original amount, and days past due in the shared AR/AP report table and CSV; change the final bucket label to start at the following day.
- [x] Update focused export tests and verify the RPCs, ERP typecheck, tests, and lint. `pnpm db:migrate` applied the SQL and regenerated types, then failed in the separate authz sync step; both revised RPCs executed directly in the local database.
- [x] Review follow-up: stage the RPC migration, align the sales invoice view assertion with its 45 columns, keep zero-net counterparties' open documents in CSV, and translate CSV headings from the request locale. Verified 13 focused tests, 107 SQL report cases, Biome, route type generation, and ERP TypeScript.
- [x] Review follow-up: resolve customer and supplier names for accounting/invoicing viewers without sales/purchasing access through company-scoped privileged reads after the export permission check.
