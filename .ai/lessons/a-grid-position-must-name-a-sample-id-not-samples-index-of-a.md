---
paths: ["apps/erp/app/modules/quality/ui/Inspections/InspectionMeasurementGrid.tsx", "apps/mes/app/components/Inspection/InspectionMeasurementMatrix.tsx"]
triggers: ["placeSamples", "inspectionSample(", "referencedTable"]
promoted: null
---
# A grid position must name a sample id, not `samples[index]` of a reloaded list

- **Context:** Inspection grids (ERP `InspectionMeasurementGrid`, MES `InspectionMeasurementMatrix`) map each column or row to an `inspectionSample`.
- **Problem:** The loader embedded `inspectionSample(*)` with no order, and an UPDATE moves a row. Each save broadcasts `inspectionSample`, so the page reloaded and `samples[index]` named another sample: the next reading was saved on the wrong part. A stubbed harness never showed it; only the running stack (realtime + Postgres) did.
- **Rule:** Order embedded children explicitly (`.order(col, { referencedTable })`). Bind a UI position to the record's id once (`placeSamples`), key per-cell state by that id, and never re-derive a position from a reloaded array's index. Test write paths on `crbn up`, not only against a stub.
- **Applies to:** any grid or list that writes through positions over data a realtime reload can reorder.
