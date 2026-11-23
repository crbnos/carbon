-- PMI artifact. The optimize ingest reads a STEP AP242 model's PMI (Product
-- Manufacturing Information: dimensions, geometric tolerances, datums, saved
-- views) and writes it beside the optimised GLB as pmi.json. NULL when the
-- model has none, or was optimised before the ingest read PMI.
-- Reuses modelUpload's RLS.

ALTER TABLE "modelUpload" ADD COLUMN IF NOT EXISTS "pmiPath" TEXT;
