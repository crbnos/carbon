-- Fix legacy slide annotations stored as non-array JSON (e.g. '{}' or NULL).
-- All consumers and ImageZoomViewer require an array of SlideAnnotation pins.

UPDATE "jobOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE "annotations" IS NULL OR jsonb_typeof("annotations") != 'array';

UPDATE "methodOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE "annotations" IS NULL OR jsonb_typeof("annotations") != 'array';

UPDATE "quoteOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE "annotations" IS NULL OR jsonb_typeof("annotations") != 'array';

UPDATE "assemblyInstructionStepSlide"
SET "annotations" = '[]'::jsonb
WHERE "annotations" IS NULL OR jsonb_typeof("annotations") != 'array';
