-- Persist the optimised GLB's byte size so the viewer can show the reduction
-- (raw STEP/glTF is kept as source of truth; its "size" never shrinks). Written
-- by the model-optimize job on success. BIGINT to match modelUpload."size".
ALTER TABLE "modelUpload" ADD COLUMN "optimizedSize" BIGINT;
