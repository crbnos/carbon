-- Step slide `annotations` is a JSON array of pins. Copying a method's slides to
-- a job passed the array to node-postgres as is, which sends a JS array as a
-- Postgres array literal: an empty one became `{}`, stored as a jsonb OBJECT.
-- The MES assembly view calls `annotations.forEach` and crashed on those rows.
-- The copy now stringifies; this resets every slide whose annotations are not
-- an array. A non-empty array could not have been stored that way (the insert
-- failed), so nothing but `{}` is lost.
UPDATE "jobOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") <> 'array';

UPDATE "methodOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") <> 'array';

UPDATE "quoteOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") <> 'array';

UPDATE "assemblyInstructionStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") <> 'array';
