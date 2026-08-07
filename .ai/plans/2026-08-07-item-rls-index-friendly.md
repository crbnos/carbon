# Make the `item` RLS policy index-friendly

## Context

The perf audit (PR #1343) found that `salesOrders`' list query spends ~400 ms in a
`Seq Scan on item` executed **100 times** — once per row of the page, inside the
`LATERAL` aggregate. The same effect forced me to revert the `purchaseOrders`
`LATERAL` rewrite, because for that view the repetition cost more than the bulk
aggregate it replaced.

The root cause is not the views. It is `item`'s RLS `SELECT` policy:

```sql
"companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
OR id IN (SELECT "itemId" FROM "supplierPart"       WHERE "supplierId" = ANY (...))
OR id IN (SELECT "itemId" FROM "customerPartToItem" WHERE "customerId" = ANY (...))
```

`id IN (SELECT …)` compiles to a **hashed SubPlan**, which is not an index path.
Postgres can only build a `BitmapOr` when every branch has an index path, so one
non-indexable branch demotes the whole predicate to a filter — and `item` is
sequentially scanned. Marking the helper functions `STABLE` does **not** help
(tested); the OR is the blocker.

## The fix

Rewrite the two portal branches so all three are index-able:

```sql
id = ANY (COALESCE((SELECT array_agg(sp."itemId") FROM "supplierPart" sp
      WHERE sp."supplierId" = ANY ((SELECT get_supplier_ids_with_supplier_permission('parts_view'))::text[])
        AND sp."itemId" IS NOT NULL), '{}'))
```

An uncorrelated `array_agg` InitPlan is evaluated once, and `id = ANY(array)` is a
`ScalarArrayOpExpr` — index-able on `item_pkey`. The plan flips from
`Seq Scan on item (40,000 rows × 100 loops)` to
`Index Scan using item_pkey (1 row × 400 loops)`.

`COALESCE(…, '{}')` matters: `array_agg` over zero rows returns NULL, and
`id = ANY(NULL)` is NULL rather than false.

## Evidence (all measured, RLS enforced as `authenticated`, claims held for the whole transaction)

| query | now | with fix |
|---|---|---|
| `salesOrders` list (LATERAL, shipped) | 432 ms | **3.7 ms** |
| `purchaseOrders` list (LATERAL, currently reverted) | 411 ms | **2.7 ms** |
| `purchaseOrders` list (subquery, currently shipped) | 49.7 ms | 55 ms |
| `parts` list | 178 ms | 182 ms |

The item lists are unaffected — their cost is the views' `DISTINCT ON` +
`revisions` aggregate, which this does not touch.

**Equivalence proven** on four synthesised personas (visible `item` row counts,
old policy vs new, same transaction):

| persona | old | new | |
|---|---|---|---|
| employee | 40000 | 40000 | same |
| supplier portal | 400 | 400 | same |
| customer portal | 7 | 7 | same |
| no access | 0 | 0 | same |

**Large-array stress**: a portal user visible to all 20,000 parts — new policy
4.3 ms vs old 7.7 ms, visible count correct at 20000. No regression from
materialising the array.

## Phase A — rewrite the `item` SELECT policy (behaviour-preserving)

- [ ] New migration `…_item-rls-index-friendly.sql`, `DROP POLICY "SELECT" ON "public"."item"` + recreate with the array form. Keep all three branches and their exact semantics.
- [ ] Re-run the four-persona equivalence check (script in the PR description) and paste the result into the migration comment.
- [ ] `EXPLAIN (ANALYZE)` `salesOrders` as `authenticated` before/after; confirm `Index Scan using item_pkey`, not `Seq Scan on item`.
- [ ] Browser-check `/x/items/parts`, `/x/sales/orders`, a part detail page.

**Risk:** this is the multi-tenant read boundary on a core table. The equivalence
evidence is from synthetic personas in a dev DB with no real portal data — that
is the weak point, and the reason this is its own phase.

## Phase B — re-apply the `purchaseOrders` LATERAL (depends on A)

Commit `e4ce8ccb1` reverted it because it was a ~7× regression. With Phase A it
becomes **2.7 ms vs the 49.7 ms currently shipped** — an 18× win, better than
either previous state.

- [ ] Restore the `purchaseOrders` `LATERAL` block (recoverable from `e4ce8ccb1^`).
- [ ] Re-verify output-identical: md5 every column of all 10k rows, old vs new.
- [ ] Re-measure under RLS; expect ~2.7 ms.
- [ ] Update the migration comment — the current one says the rewrite is a
      regression, which is only true *before* Phase A.

## Phase C — same shape elsewhere

`itemCost` `[SELECT, UPDATE]` has the identical OR + `IN (SELECT …)` construction
and also seq-scans under RLS (confirmed; it has 0 rows in dev so the timing is
not meaningful, but the plan shape is). `customerPartToItem` and `user` share the
pattern but are small and off the hot path.

- [ ] Apply the same array rewrite to `itemCost` SELECT.
- [ ] Decide on `item`/`itemCost` UPDATE + DELETE policies — same shape, and they
      matter for bulk writes (the bulk item update path touches many rows).
- [ ] Leave `customerPartToItem` and `user` unless measurement justifies them.

## Phase D — two portal bugs found on the way (needs a product decision, separate PR)

These are **pre-existing** and not caused by any of this work. Both are about
whether the supplier portal is meant to work at all.

**D1 — the supplier branch of the `item` policy is unreachable.**
`supplierPart`'s own SELECT policy is `companyId IN (employee parts_view ∪
purchasing_view)` — purely employee-gated, no portal branch. So when a
supplier-portal user is checked against `item`'s branch 2, the inner
`supplierPart` read returns nothing and they see **zero** items. I only produced
a non-zero supplier count above by adding a temporary permissive policy for the
test. Either the supplier portal cannot list parts today, or portal access runs
through a different mechanism (the `share+/` routes are token-based) and the
branch is dead weight. Needs a product answer before changing.

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

Whether the intent was union or override is a product question. Phase A
**preserves the current behaviour exactly**, bug included — it must not be
bundled with a fix here.

- [ ] Get a product decision on D1 (should supplier-portal users list items?).
- [ ] Get a decision on D2 (union the two paths, or is override intended?).
- [ ] Fix in a separate, security-reviewed PR with the persona harness extended.

## Verification

Reusable four-persona equivalence harness (synthesise employee / supplier /
customer / no-access, count visible `item` rows under both policy versions in one
rolled-back transaction). Worth keeping as a durable check —
`packages/checks` has a SQL-invariants mechanism that could host a
"portal user sees exactly their mapped items" assertion so a future policy edit
cannot silently widen access.

Gates: `pnpm --filter @carbon/checks test`, `clobbers`, scoped typecheck, and a
browser pass over the item and order list screens.

## Sequencing

A → B are one PR (B is only correct given A). C is a follow-up once A is proven
in a real environment. D is independent and blocked on product input.
