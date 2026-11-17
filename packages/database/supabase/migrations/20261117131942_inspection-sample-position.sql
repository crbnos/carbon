-- The grid column (or row) an inspector entered a sample in, so a reload, another
-- device or another inspector shows it in the same place. NULL for samples made
-- before this column, and for serial samples, which keep their scan order.
ALTER TABLE "inspectionSample" ADD COLUMN "position" INTEGER;
