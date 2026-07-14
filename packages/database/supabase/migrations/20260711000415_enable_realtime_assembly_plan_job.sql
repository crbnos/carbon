-- Realtime on assemblyPlanJob: the assembly-instruction UI subscribes to plan
-- job status flips (Queued → Processing → Success/Failed) so plan completion
-- pushes to the browser instead of relying on a component-local polling flag
-- that dies on remount.
ALTER PUBLICATION supabase_realtime ADD TABLE "assemblyPlanJob";
