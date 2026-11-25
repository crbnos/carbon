-- Company option for taking the serial number from the issued component.
-- With the setting on, a serial unit that has no number takes the number of
-- the one serial part it is made from, when that part is issued into it.

SET lock_timeout = '5s';

-- Off by default, so no company changes.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "serialNumberFromComponent" BOOLEAN NOT NULL DEFAULT false;
