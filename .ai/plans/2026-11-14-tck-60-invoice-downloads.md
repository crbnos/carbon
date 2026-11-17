# TCK-60 invoice downloads

- [x] Follow TCK-59's direct GET download pattern for Sales and Purchase Invoices, with CSV and ExcelJS workbook responses.
- [x] Pass the active table search, filters, sorts, and saved-view export columns to both formats on desktop and phone.
- [x] Remove the `exportOnServer` background-job special case and update the export guidance.
- [x] Verify focused CSV/workbook tests, Biome, and ERP typecheck.

Verification: ERP 3,915 tests passed; database 717 tests passed; both rollback-only
invoice SQL checks passed; ERP and database typechecks, Biome, migration clobber,
six dataset checks, backup compatibility, and Lingui compile passed.
