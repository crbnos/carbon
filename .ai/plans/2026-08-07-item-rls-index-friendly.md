# Make the `item` RLS policy index-friendly

**Status: Phases A and B shipped in PR #1343.** Phases C and D are still open.
The migration comments are the authoritative record; this file is the summary
plus the outstanding work.

## What shipped

`item`'s SELECT policy ORed one index-able branch with two `id IN (SELECT …)`
portal branches. `id IN (SELECT …)` compiles to a hashed SubPlan, which is not an
index path, and a `BitmapOr` requires *every* branch to have one — so a single
non-indexable branch demoted the whole predicate to a filter and `item` could
only be reached by sequential scan.

`20260807093015_item-rls-index-friendly.sql` rewrites the two portal branches as
`id = ANY (COALESCE((SELECT array_agg(…)), '{}'))` — an uncorrelated `array_agg`
InitPlan evaluated once, plus a `ScalarArrayOpExpr` that can use `item_pkey`.
`COALESCE(…, '{}')` matters: `array_agg` over zero rows returns NULL, and
`id = ANY (NULL)` is NULL rather than false.

That alone was not enough. The order-list views also needed an index supplying
each list's default sort (`20260806235710`), or Postgres had to produce every row
before applying `LIMIT`, running the per-order aggregate once per order in the
company. Both pieces are required and they compound — see the header of
`20260807011742_lateralize-order-list-views.sql` for the full matrix.

Net, page 1 of each list, measured as `authenticated` with RLS enforced, claims
held for the whole transaction, statistics present, real projection and real
`ORDER BY`, vs `origin/main`:

| query | before | after |
|---|---|---|
| `salesOrders` | ~200 ms | **~6.6 ms** |
| `purchaseOrders` | ~72 ms | **~1.7 ms** |
| item lists (`parts`, …) | 60–200 ms | unchanged |

The item lists are untouched: their cost is the views' `DISTINCT ON` + revisions
aggregate, which materialises every row regardless of the limit. Removing their
`ORDER BY` does not speed them up, which is what distinguishes them from the
order views. A lateral-driven rewrite measures ~130× faster but only when sorted
by `readableId` rather than the displayed `readableIdWithRevision`; that is a
visible-ordering change, so it is deliberately not done here.

## Equivalence evidence

Compared the **md5 of the sorted visible `item` id set** (not just counts) under
the old and new policy, in one rolled-back transaction per persona:

| persona | old | new | |
|---|---|---|---|
| employee | 40000 | 40000 | same |
| supplier portal | 400 | 400 | same — **test-only, see below** |
| customer portal | 7 | 7 | same |
| no access | 0 | 0 | same |

> The supplier row is **not** production evidence. `supplierPart`'s own SELECT
> policy is employee-gated, so branch 2 is unreachable for a real supplier-portal
> user — the 400 was only produced by adding a temporary permissive policy so the
> branch was exercised at all. It shows the rewrite preserves the branch's
> semantics; it does not show a supplier-portal user can read anything. That is
> bug D1 below.

The two order views were separately verified against the definitions they
replace with a bidirectional `EXCEPT ALL` over every row cast to text (stricter
than an md5 aggregate: it is multiset-aware and identifies differing rows):
0 rows in both directions for both views, with identical row counts.

## Phase C — same shape elsewhere (open)

`itemCost` `[SELECT, UPDATE]` has the identical OR + `IN (SELECT …)` construction
and also seq-scans under RLS (confirmed; it has 0 rows in dev so the timing is
not meaningful, but the plan shape is). `customerPartToItem` and `user` share the
pattern but are small and off the hot path.

- [ ] Apply the same array rewrite to `itemCost` SELECT.
- [ ] Decide on `item`/`itemCost` UPDATE + DELETE policies — same shape, and they
      matter for bulk writes.
- [ ] Leave `customerPartToItem` and `user` unless measurement justifies them.

## Phase D — two portal bugs found on the way (open, needs a product decision)

Both are **pre-existing**, and `20260807093015` preserves them exactly rather
than fixing them, so that it stays a pure performance change.

**D1 — the supplier branch of the `item` policy is unreachable.**
`supplierPart`'s own SELECT policy is `companyId IN (employee parts_view ∪
purchasing_view)` — purely employee-gated, no portal branch. So when a
supplier-portal user is checked against `item`'s branch 2, the inner
`supplierPart` read returns nothing and they see **zero** items. Either the
supplier portal cannot list parts today, or portal access runs through a
different mechanism (the `share+/` routes are token-based) and the branch is dead
weight.

**D2 — `get_supplier_ids_with_supplier_permission` discards its own first result.**

```sql
SELECT array_agg(c.id) INTO supplier_ids FROM "supplier" c WHERE c."companyId" = ANY(permission_companies);
SELECT array_agg(ca."supplierId") INTO supplier_ids FROM "supplierAccount" ca WHERE ca.id::uuid = auth.uid() AND ...;
```

The second `INTO` overwrites the first unconditionally — and `array_agg` over
zero rows is NULL, so a user who qualifies via the permission path but has no
`supplierAccount` row ends up with NULL, not their suppliers. Confirmed
empirically: 50 suppliers matched by the first query, helper returned NULL.
`get_customer_ids_with_customer_permission` is identical in shape.

- [ ] Get a product decision on D1 (should supplier-portal users list items?).
- [ ] Get a decision on D2 (union the two paths, or is override intended?).
- [ ] Fix in a separate, security-reviewed PR with the persona harness extended.

## Verification notes for whoever picks this up

- Reusable four-persona harness: synthesise employee / supplier / customer /
  no-access, compare the visible `item` id set under both policy versions in one
  rolled-back transaction. `packages/checks` has a SQL-invariants mechanism that
  could host a "portal user sees exactly their mapped items" assertion so a
  future policy edit cannot silently widen access.
- Run `pnpm run generate:types` after any migration, before scoped typecheck.
  For these three migrations it produces no schema-driven change (the only diff
  is non-deterministic FK-ordering churn in the generator).
- Benchmark the query the service actually builds — projection **and** the
  `ORDER BY` from `setGenericQueryFilters`. Omitting the sort is what produced
  the original wrong figures for this work.
- Run `ANALYZE` first and check `pg_stat_user_tables.last_analyze`; the seeded
  tables had never been analysed, which made plan choice unstable.

Gates: `pnpm --filter @carbon/checks test`, scoped typecheck, and a browser pass
over the item and order list screens.
