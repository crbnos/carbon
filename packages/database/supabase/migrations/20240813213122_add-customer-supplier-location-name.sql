-- Add name column to customerLocation
-- 1. Add the new column with a temporary default value
ALTER TABLE public."customerLocation"
  ADD COLUMN "name" text DEFAULT 'Temporary Name';

-- 2. Update the new column with values from the related "address" table
UPDATE public."customerLocation" cl
  SET "name" = a."city"
  FROM public."address" a
  WHERE cl."addressId" = a."id";

-- 3. Alter the column to be non-nullable
ALTER TABLE public."customerLocation"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "name" DROP DEFAULT;

-- Add name column to supplierLocation
-- 1. Add the new column with a temporary default value
ALTER TABLE public."supplierLocation"
  ADD COLUMN "name" text DEFAULT 'Temporary Name';

-- 2. Update the new column with values from the related "address" table
UPDATE public."supplierLocation" sl
  SET "name" = a."city"
  FROM public."address" a
  WHERE sl."addressId" = a."id";

-- 3. Alter the column to be non-nullable
ALTER TABLE public."supplierLocation"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "name" DROP DEFAULT;
