# Production Order Golden Path Fixtures

The implementation exports exactly three fixtures from
`packages/utils/src/production-order-mapping.fixtures.ts`. All are sanitized,
synthetic, `SCHEMA_VALIDATED_FIXTURE` and `NOT_PRODUCTION_RECORD`.

| Fixture | Source shape | Expected behavior |
| --- | --- | --- |
| A — `normalLinked` | ERP Work Order + explicit confirmed lineage + Carbon Job + JobOperation | Merge allowed; both source refs and authority labels retained. |
| B — `partialCompletion` | Planned 10, execution 4, operation completion 4 | Planning/execution metrics remain distinct; no fabricated canonical percentage. |
| C — `quantityRegression` | Aggregate 1, operation 1, Job 0 | Preserve source values; canonical completion and progress remain undefined. |

These fixtures prove contract behavior only. They do not prove that a live
ERPNext Work Order is ingested into Carbon or that the synthetic IDs exist in a
production tenant.
