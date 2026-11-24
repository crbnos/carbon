---
paths: ["apps/erp/app/components/Table/utils.ts"]
triggers: ["buildColumnMaps", "exportValue"]
promoted: null
---
# A server export mapping cannot add a column the browser omitted

**Context:** Verifying sales-invoice customer names in the CSV (TCK-60).
**Problem:** The registry resolved both names, but the table's Customer columns had only `id` and `cell`. `buildColumnMaps` excluded them, so the export request never asked for either name.
**Rule:** A display column needs `meta.exportValue` to participate in CSV export. Check the actual request's column list and the generated file; a registry mapping alone does not prove the column exports.
**Applies to:** ERP Table display columns, `buildColumnMaps`, and list-registry `exportValues`.
