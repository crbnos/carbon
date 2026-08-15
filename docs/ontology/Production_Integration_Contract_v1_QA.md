# Production Integration Contract v1 — QA

## Scope

This QA report covers v1 contract-only implementation in `@carbon/utils` plus supporting ontology docs.

## Checks executed (code/tests)

| Area | Command | Result |
| --- | --- | --- |
| Mapping registry validation | `validateProductionOrderMappings(productionOrderMappingRegistry)` | PASS (active entries, valid authorities/transforms/confidence) |
| Merge gating by confirmed lineage | unit test | PASS |
| 1/1/0 regression | unit test (`productionOrderGoldenPathFixtures.quantityRegression`) | PASS |
| ProductionRelease validation | new unit tests for valid/invalid payloads | PASS |
| SourceLineage validation | unit tests for confirmed IDs and relation safety | PASS |
| Contract boundary validation | unit test (`validateProductionOrderContract`) | PASS |
| Fixture set cardinality | unit test | PASS (3 fixtures) |

## Notes

- This branch does not include `vitest`/`tsgo`/`biome` executions from package binaries in this isolated worktree due no installed local toolchain in the worktree folder.
- Commands should be re-run in a fully prepared environment before merge.

## Regression coverage

- `productionAggregate = 1`
- `operationCompletedQuantity = 1`
- `jobQuantityComplete = 0`
- canonical completed/progress are intentionally undefined in v1 schema.
