-- Make `item`'s SELECT policy index-friendly.
--
-- The policy is an OR of three branches. The first is already index-able
-- (`"companyId" = ANY (array)`), but the two portal branches were written as
-- `id IN (SELECT ...)`, which Postgres compiles to a hashed SubPlan. A SubPlan
-- is not an index path, and a BitmapOr requires EVERY branch to have one, so a
-- single non-indexable branch demotes the whole predicate to a filter and the
-- planner can only reach `item` by sequential scan.
--
-- That is survivable when `item` is scanned once. It is not survivable when
-- `item` is reached once per outer row: the salesOrders list view produced
--   Seq Scan on item (rows=40000, loops=10000)
-- — 400M row visits, 43s for one page of 100 orders.
--
-- Rewritten so all three branches are index-able. An uncorrelated `array_agg`
-- is evaluated once as an InitPlan, and `id = ANY (array)` is a
-- ScalarArrayOpExpr, which CAN use item_pkey. The plan flips from
--   Seq Scan on item (rows=40000, loops=10000)   43,454 ms
-- to
--   Index Scan using item_pkey (rows=1, loops=40000)   219 ms
--
-- COALESCE(..., '{}') matters: array_agg over zero rows returns NULL, and
-- `id = ANY (NULL)` is NULL rather than false. Both NULL and false mean "not
-- visible" inside a USING clause, but the COALESCE keeps the intent explicit.
--
-- Semantics are UNCHANGED, including two pre-existing quirks this deliberately
-- preserves rather than fixes (they belong in their own security-reviewed
-- change): `supplierPart`'s own SELECT policy is employee-gated, so branch 2 is
-- unreachable for a real portal user; and both `get_*_ids_with_*_permission`
-- helpers overwrite their first `SELECT ... INTO` with a second, so the
-- permission path is discarded. This migration calls the same helpers and so
-- inherits the same behaviour exactly.
--
-- Equivalence verified against four synthesised personas in one rolled-back
-- transaction, comparing the md5 of the sorted visible id set (not just the
-- count), with both portal branches made reachable by a temporary permissive
-- policy so the branches were actually exercised:
--
--   persona    old policy            new policy
--   employee   40000  8ff8d9fbadfe   40000  8ff8d9fbadfe   same
--   supplier     400  ddd8d332865b     400  ddd8d332865b   same
--   customer       7  3b0780d09b4e       7  3b0780d09b4e   same
--   no access      0  d41d8cd98f00       0  d41d8cd98f00   same

DROP POLICY "SELECT" ON "public"."item";

CREATE POLICY "SELECT" ON "public"."item"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  OR id = ANY (COALESCE((
        SELECT array_agg(sp."itemId")
        FROM "supplierPart" sp
        WHERE sp."supplierId" = ANY (
                (SELECT get_supplier_ids_with_supplier_permission('parts_view'))::text[]
              )
          AND sp."itemId" IS NOT NULL
      ), '{}'::text[]))
  OR id = ANY (COALESCE((
        SELECT array_agg(cpi."itemId")
        FROM "customerPartToItem" cpi
        WHERE cpi."customerId" = ANY (
                (SELECT get_customer_ids_with_customer_permission('parts_view'))::text[]
              )
          AND cpi."itemId" IS NOT NULL
      ), '{}'::text[]))
);
