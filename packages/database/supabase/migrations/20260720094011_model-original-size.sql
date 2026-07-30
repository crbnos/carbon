-- Bytes of the file AS UPLOADED, frozen at upload time. "size" cannot carry
-- this: raw compaction (model-optimize) overwrites it with the stored .zst
-- size so file lists reflect disk usage — which silently changed the viewer's
-- "original -> optimized" reduction badge to compare the compacted raw instead
-- of the true original. Nullable; rows from before this column fall back to
-- "size" in the UI.
ALTER TABLE "modelUpload" ADD COLUMN "originalSize" BIGINT;
