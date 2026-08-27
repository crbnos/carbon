-- Which kind of Onshape element a synced model came from.
--
-- The row already records WHERE the model came from (documentId / versionId /
-- elementId) but not WHAT it was, and Onshape's API splits on exactly that: a
-- translation is requested from /partstudios/... or /assemblies/..., and the two
-- are not interchangeable. Anything acting on a synced model after the fact — an
-- on-demand STEP export, or telling a part apart from an assembly in the sync
-- dashboard — has to re-derive the kind from Onshape without this.
--
-- Nullable, and deliberately not backfilled: rows written before this column
-- existed genuinely do not know, and inventing a default would make "we never
-- recorded it" indistinguishable from "we recorded a part studio". A re-pull
-- fills it in.
--
-- Drawings (assetKind = 'drawing') are their own element type and never carry
-- this, so the CHECK covers only the two model kinds.
ALTER TABLE "onshapeItemSyncState"
    ADD COLUMN "elementKind" TEXT
    CHECK ("elementKind" IN ('partstudio', 'assembly'));

COMMENT ON COLUMN "onshapeItemSyncState"."elementKind" IS
  'Onshape element kind the model was exported from: partstudio or assembly. Null for drawings and for rows written before the column existed.';
