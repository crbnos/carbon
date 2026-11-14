# Invoice GL codes in lists and exports

- [x] Read line account numbers for sales and purchase invoices through a company-scoped, invoicing-authorized lookup, resolving the Sales account default for ordinary sales lines without an assigned account.
- [x] Add a GL Codes column to both invoice tables and include it in browser and background CSV exports using the same value.
- [x] Apply the migration, regenerate types, and verify the SQL lookup, list and export code, types, tests, and schema checks.

The list shows each invoice's distinct line account numbers, separated by commas. Ordinary sales lines without an assigned account use the configured Sales account. Specialized sales lines and purchase lines without an assigned account do not add a code.
