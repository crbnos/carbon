-- A label printer's print density in dots per inch; existing printers keep 203.
ALTER TABLE "printerRoute"
  ADD COLUMN "dpi" INTEGER NOT NULL DEFAULT 203
  CONSTRAINT "printerRoute_dpi_check" CHECK ("dpi" IN (203, 300, 600));
