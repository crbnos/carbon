# Invoice GL codes in lists and exports

- [x] Read assigned line account numbers for sales and purchase invoices through a company-scoped, invoicing-authorized lookup.
- [x] Add a GL Codes column to both invoice tables and include it in browser and background CSV exports using the same value.
- [x] Apply the migration, regenerate types, and verify the SQL lookup, list and export code, types, tests, and schema checks.

The list shows each invoice's distinct assigned line account numbers, separated by commas. Lines without an assigned account do not add a code.
