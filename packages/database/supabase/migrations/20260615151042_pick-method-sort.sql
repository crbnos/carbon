-- Per-item, per-location tracked-entity pick order. Drives the default
-- selection of the FEFO/FIFO/LIFO/Default dropdown in TrackedEntityPicker
-- when picking serial/batch material. 'Default' = the picker's smart order
-- (expiring soonest first, then oldest created).
CREATE TYPE "pickMethodSortMethod" AS ENUM ('Default', 'FEFO', 'FIFO', 'LIFO');

ALTER TABLE "pickMethod"
  ADD COLUMN "sortMethod" "pickMethodSortMethod" NOT NULL DEFAULT 'Default';
