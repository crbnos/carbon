# Aging export pagination

- [x] Confirm truncation: CSV routes await unpaged RPCs capped at 1,000 rows.
- [x] Reuse fetchAllRecords with stable ordering for both export RPCs; preserve ordinary page reads.
- [x] Batch and page party-name lookups with fetchAllByIds.
- [x] Run report and pager tests (27 passed), scoped ERP typecheck (passed), and Biome checks (passed).
