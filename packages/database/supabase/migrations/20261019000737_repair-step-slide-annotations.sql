-- Step slide pins copied as `{}` instead of a list.
--
-- Since step slides were first copied (20260727, #1178) get-method wrote a
-- copied slide's `annotations` raw through the Postgres driver (deno-postgres,
-- then node-postgres), which sends a JS array as a Postgres array literal. A
-- slide with pins failed the whole copy; a slide with none was stored as `{}`
-- — a JSON object, where every reader expects a list and `.map` throws.
-- get-method now writes valid JSON and the readers guard; this repairs the
-- rows already written. A list is never an object, so no slide with pins is
-- touched.

UPDATE "methodOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") = 'object';

UPDATE "jobOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") = 'object';

UPDATE "quoteOperationStepSlide"
SET "annotations" = '[]'::jsonb
WHERE jsonb_typeof("annotations") = 'object';
