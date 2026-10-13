-- sync_finish_job_operation has two overloads. The interceptor dispatcher calls
-- (table, operation, new, old); the older (new, old, operation) form is left
-- over from before that contract and nothing calls it. A managed function file
-- (event-system/handlers/sync_finish_job_operation.sql) defines exactly one
-- function, and `authz sync` refuses a second overload.
DROP FUNCTION IF EXISTS public.sync_finish_job_operation(jsonb, jsonb, text);
