# Operation Lineage v1

## Goal

Track operation identity only where evidence is explicit; do not over-assert when identifiers are missing.

## Supported relationships

| Upstream | Downstream | Relation | Status |
| --- | --- | --- | --- |
| Carbon Job | Carbon JobOperation | `contains` | confirmed (internal IDs available) |
| ERP Work Order | Carbon Job | `released-to` / `derived-from` | requires explicit lineage source |
| ERP operation | Carbon JobOperation | `executes` / `contains` | unresolved if no stable cross-id |

## v1 contract behavior

- ERP operation IDs are preserved only as source refs if available.
- Carbon MES operation IDs and status are preserved in `Operation` projections.
- No assumption is made that one operation ID maps 1:1 without explicit `relation + source IDs`.
- Confidence for carbon-side completion remains explicit and authority-bound.

## Supported cardinalities

- `1:N`, `N:1`, `N:N`, and `UNRESOLVED` are representable.
- `N` indicates that unresolved operation mapping does not block order merge.
