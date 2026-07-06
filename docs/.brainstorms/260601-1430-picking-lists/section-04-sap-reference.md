# SAP Reference: Picking Lists for Production

Research summary of how SAP S/4HANA and SAP Digital Manufacturing handle production picking/staging.

## Key Concepts Adopted

### MF60 Pull List Pattern
SAP's Pull List is a computed view that checks stock at the production storage location, calculates missing quantities across production orders, and proposes material transfers. This inspired our schedule-based Picking Needs view — always live, computed from current data, no pre-generation.

### Production Material Request (PMR)
SAP's lightweight staging request document. Created when a production order is released, it contains products, quantities, target Production Supply Area, and staging date. This inspired our `pickingList` entity — purpose-built, lightweight, not a repurposed transfer document.

### Production Supply Area (PSA)
SAP's concept for lineside/point-of-use storage near a work center. Contains storage bins assigned to a storage location. This inspired our `storageUnit.workCenterId` approach — marking storage units as lineside by associating them with a work center.

### Per-Component Staging Indicator
SAP allows each BOM component to have a staging indicator (Pick Parts, Release Order Parts, Kanban, Not Relevant). We chose a simpler derived approach instead — the system determines whether a pick is needed based on the source storage unit's lineside status.

## Concepts Deferred

### Extended Warehouse Management (EWM)
SAP's full warehouse management with bin-level tracking, warehouse tasks, warehouse orders, and RF-directed picking. Too complex for v1 — Carbon's storage unit hierarchy provides sufficient granularity.

### Kanban Replenishment
SAP supports container-based pull signals for continuous replenishment. Deferred — Carbon's warehouse transfers already handle non-job-specific lineside replenishment.

### JIT/JIS (Just-In-Time / Just-In-Sequence)
SAP supports staging materials in exact assembly sequence. Deferred — relevant for high-volume automotive-style manufacturing, not typical Carbon use cases.

### Batch Determination Condition Technique
SAP's full batch determination engine uses configurable condition tables, access sequences, and strategy types. We simplified to FIFO by receipt date as the default strategy, which covers the majority of use cases.

## Key SAP Design Principles Applied

1. **Separate demand from execution** — What's needed (computed view) vs. what to do about it (picking list entity).
2. **Per-component flexibility** — Not all materials are treated the same; some need picking, some are lineside, some are backflushed.
3. **Support both pre-pick and backflush** — Allow both models to coexist on the same production order.
4. **Lightweight staging document** — PMR over delivery-based staging; purpose-built over repurposed.
5. **Staging is optional** — Materials already at the line skip the picking workflow entirely.
