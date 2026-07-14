-- Enable Supabase Realtime for the documentExtraction table.
--
-- Without this, postgres_changes events are never broadcast, so the
-- useDocumentExtraction hook's channel subscription receives no UPDATE
-- events. The UI would only refresh when the tab regains focus
-- (visibilitychange triggers a forceReconnect → fetchInitial).
--
-- This MUST be added as a separate migration because the table was
-- created in 20260609001724_add-document-extraction.sql which has
-- already been applied and cannot be edited.

ALTER publication supabase_realtime ADD TABLE "documentExtraction";

