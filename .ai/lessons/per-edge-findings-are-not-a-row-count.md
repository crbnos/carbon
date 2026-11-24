---
paths: []
triggers: []
promoted: null
---
# Per-edge findings are not a row count

**Context:** `findExportScopeViolations` returns one entry per offending FK edge
(`jobOperationDependency` violates `jobId`, `operationId` and `dependsOnId`), and the
backup UI summed `violations[].rows` for the figure it showed the user.

**Problem:** A row escaping scope through three foreign keys was counted three times.
The failed-backup banner claimed "10 rows" where 4 rows existed, and the same sum sat on
the confirm button of an irreversible delete that then removed 4 — the toast and the
modal disagreed inside one flow.

**Rule:** When a diagnostic groups by RELATIONSHIP (FK edge, constraint, rule), it
cannot be summed into a count of ROWS. Compute the distinct count separately — one
`count(*)` over the OR of the offending predicates — and keep the per-edge list purely
as the breakdown. Name the two so they cannot be confused (`violations` vs
`rowsByTable`) and say so in the type's doc comment.

**Applies to:** `packages/jobs/src/backups/scope.ts`
(`findExportScopeViolationsDetailed`, `computeScopeExclusions`, `totalExcludedRows`),
`Manifest.excludedRowsByTable`, and any future "N things are wrong" surface.
