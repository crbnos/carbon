-- "size" must always be the customer's AS-UPLOADED bytes: it feeds every
-- "modelSize" view/RPC and the file lists, which display the customer's file.
-- Compaction used to rewrite it to the internal ".xbf.zst"/".zst" artifact's
-- size (the compact job no longer does); restore the frozen original bytes on
-- rows that were rewritten.
UPDATE "modelUpload"
SET "size" = "originalSize"
WHERE "originalSize" IS NOT NULL
  AND "size" IS DISTINCT FROM "originalSize";
