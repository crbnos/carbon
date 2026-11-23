-- Webhooks for make methods, their materials and operations, CAD models and change
-- notices, so an integration that pushes a BOM or a model hears when someone edits
-- it, and when a change notice releases. makeMethod, methodOperation and
-- modelUpload get their event triggers from the generated migration that follows;
-- the others already emit events.
INSERT INTO "webhookTable" ("table", "module", "name") VALUES
  ('makeMethod', 'Items', 'Make Method'),
  ('methodMaterial', 'Items', 'Method Material'),
  ('methodOperation', 'Items', 'Method Operation'),
  ('modelUpload', 'Items', 'Model Upload'),
  ('changeOrder', 'Items', 'Change Notice'),
  ('changeOrderAffectedItem', 'Items', 'Change Notice Item')
ON CONFLICT ("table") DO NOTHING;
