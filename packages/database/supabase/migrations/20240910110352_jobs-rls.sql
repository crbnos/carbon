-- ALTER TABLE "job" ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Requests with an API key can access jobs" ON "job"
-- FOR ALL USING (
--   has_valid_api_key_for_company("companyId")
-- );

-- CREATE POLICY "Requests with an API key can select users from their company" ON "user"
-- FOR SELECT USING (
--   EXISTS (
--     SELECT 1
--     FROM "userToCompany"
--     WHERE "userToCompany"."userId" = "user"."id"::text
--     AND "userToCompany"."companyId" IN (
--       SELECT "companyId"
--       FROM "apiKey"
--       WHERE "apiKey"."key" = current_setting('request.header.carbon-key', true)
--     )
--   )
-- );

-- -- Add workInstruction column to quoteOperation table
-- ALTER TABLE "quoteOperation" ADD COLUMN "workInstruction" JSON NOT NULL DEFAULT '{}';

-- -- Migrate data from quoteOperationWorkInstruction to quoteOperation
-- UPDATE "quoteOperation" qo
-- SET "workInstruction" = qowi.content
-- FROM "quoteOperationWorkInstruction" qowi
-- WHERE qo.id = qowi."quoteOperationId";

-- -- Add workInstruction column to jobOperation table
-- ALTER TABLE "jobOperation" ADD COLUMN "workInstruction" JSON NOT NULL DEFAULT '{}';

-- -- Migrate data from jobOperationWorkInstruction to jobOperation
-- UPDATE "jobOperation" jo
-- SET "workInstruction" = jowi.content
-- FROM "jobOperationWorkInstruction" jowi
-- WHERE jo.id = jowi."jobOperationId";

-- -- Add workInstruction column to methodOperation table
-- ALTER TABLE "methodOperation" ADD COLUMN "workInstruction" JSON NOT NULL DEFAULT '{}';

-- -- Migrate data from methodOperationWorkInstruction to methodOperation
-- UPDATE "methodOperation" mo
-- SET "workInstruction" = mowi.content
-- FROM "methodOperationWorkInstruction" mowi
-- WHERE mo.id = mowi."methodOperationId";

-- -- Drop the old work instruction tables
-- DROP TABLE "quoteOperationWorkInstruction";
-- DROP TABLE "jobOperationWorkInstruction";
-- DROP TABLE "methodOperationWorkInstruction";

-- -- Drop the associated trigger if it exists
-- DROP TRIGGER IF EXISTS create_quote_operation_related_records ON public."quoteOperation";
-- -- Drop the function that creates quote operation work instructions
-- DROP FUNCTION IF EXISTS public.create_quote_operation_work_instruction();


-- -- Drop the associated trigger for method operation
-- DROP TRIGGER IF EXISTS create_part_make_method_related_records ON public."methodOperation";
-- -- Drop the function that creates method operation work instructions
-- DROP FUNCTION IF EXISTS public.create_method_operation_work_instruction();


-- -- Drop the associated trigger for job operation (if it exists)
-- DROP TRIGGER IF EXISTS create_job_operation_related_records ON public."jobOperation";
-- -- Drop the function that creates job operation work instructions (if it exists)
-- DROP FUNCTION IF EXISTS public.create_job_operation_work_instruction();


-- DROP VIEW "quoteOperationsWithMakeMethods";
-- COMMIT; 
-- CREATE OR REPLACE VIEW "quoteOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
--   SELECT 
--     mm.id AS "makeMethodId",
--     qo.*
--   FROM "quoteOperation" qo
--   INNER JOIN "quoteMakeMethod" qmm 
--     ON qo."quoteMakeMethodId" = qmm.id
--   LEFT JOIN "makeMethod" mm 
--     ON qmm."itemId" = mm."itemId";