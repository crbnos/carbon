-- A training's content can also be one YouTube video, stored as its watch
-- link. Like the PDF guide, it replaces the written content.
ALTER TABLE "training"
  ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;
