-- Track the as-uploaded original model file separately from "modelPath", which
-- compaction repoints at a derived artifact (STEP → OCCT BinXCAF "{id}.xbf.zst").
-- The original is what customers download; ".xbf" is not openable by CAD tools.
-- Null = original not available (legacy rows compacted before this column, or
-- mesh rows whose ".zst" modelPath decompresses to the identical original bytes).
ALTER TABLE "modelUpload" ADD COLUMN "originalPath" TEXT;
