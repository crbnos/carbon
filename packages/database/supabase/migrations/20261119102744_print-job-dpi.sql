-- The print density a job's ZPL was drawn for; every job before this was drawn for 203 dpi.
ALTER TABLE "printJob"
  ADD COLUMN "dpi" INTEGER NOT NULL DEFAULT 203
  CONSTRAINT "printJob_dpi_check" CHECK ("dpi" IN (203, 300, 600));
