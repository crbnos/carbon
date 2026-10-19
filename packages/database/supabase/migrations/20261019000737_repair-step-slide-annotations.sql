-- get-method copied a slide with no pins as `{}` (a JS array sent raw through
-- the Postgres driver); readers expect a list. Slides with pins are untouched.

UPDATE "methodOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") = 'object';

UPDATE "jobOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") = 'object';

UPDATE "quoteOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") = 'object';
