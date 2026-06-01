-- Item-target rules: scope by item type and/or item group instead of the blunt
-- "applies to all items" broadcast.
--
-- `appliesToAll` is RETAINED — it still governs broadcast for storageUnit /
-- workCenter rules (which have no type/group concept). For item rules the form
-- drops the toggle and uses these filters instead: empty arrays = every item;
-- otherwise the rule fires on items matching the selected types and/or groups
-- (`filteredItemMatchAll` chooses OR vs AND between the two dimensions).
ALTER TABLE "customRule"
  ADD COLUMN "filteredItemTypes"    TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN "filteredItemGroupIds" TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN "filteredItemMatchAll" BOOLEAN NOT NULL DEFAULT false; -- false = OR (any), true = AND (all)
