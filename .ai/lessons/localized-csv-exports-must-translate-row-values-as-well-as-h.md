---
paths: ["apps/erp/app/routes/x+/reports+/*csv.tsx", "apps/erp/app/routes/x+/reports+/aging.server.ts"]
triggers: ["agingCsvResponse", "text/csv"]
promoted: null
---
# Localized CSV exports must translate row values as well as headings

**Context:** The AR/AP aging CSV translated its column headings, while the document
type column still contained raw `Invoice`, `Credit Memo`, and `Debit Memo` values.

**Problem:** In a non-English locale, the downloaded report mixed translated
headings with English document types even though the on-screen workbench and
catalogs already translated those values.

**Rule:** Resolve fixed display values through the same per-request catalog used
for CSV headings, while retaining raw values for data logic and falling back to
the raw value for an unknown type. Assert the exported row values with labels
that differ from the source strings.

**Applies to:** Server-generated localized CSV reports, including AR/AP aging.
