-- Optimised model artifact. On upload, mesh models (STEP / glTF / GLB) are
-- eagerly run through the assembler's /v1/optimize (merge + simplify + meshopt/
-- Draco encode) into a compact GLB. This is separate from the assembly-convert
-- artifact ("glbPath"): that one is lossless and feeds the animated assembly
-- viewer; this one is the aggressively-optimised version for storage/preview.
-- Reuses the existing "modelProcessingStatus" enum and modelUpload's RLS.

ALTER TABLE "modelUpload" ADD COLUMN "optimizedModelPath" TEXT;
ALTER TABLE "modelUpload" ADD COLUMN "optimizeStatus" "modelProcessingStatus" NOT NULL DEFAULT 'Idle';
ALTER TABLE "modelUpload" ADD COLUMN "optimizeError" TEXT;
ALTER TABLE "modelUpload" ADD COLUMN "optimizedAt" TIMESTAMP WITH TIME ZONE;
