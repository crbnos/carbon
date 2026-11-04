-- A receipt line's tracked units, looked up by the line (receipt putaway,
-- serial boxes, inspection lots). The GIN index on "attributes" serves @>, not
-- ->> =, so each lookup read every unit of the company. The predicate is
-- implied by `->> 'Receipt Line' = $1`, so those queries can use it.
CREATE INDEX IF NOT EXISTS "trackedEntity_companyId_receiptLine_idx"
  ON "trackedEntity" ("companyId", ("attributes" ->> 'Receipt Line'))
  WHERE ("attributes" ->> 'Receipt Line') IS NOT NULL;
