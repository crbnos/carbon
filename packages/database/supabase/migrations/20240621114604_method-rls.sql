ALTER TABLE "methodOperation" ADD COLUMN "customFields" JSONB;
ALTER TABLE "methodMaterial" ADD COLUMN "customFields" JSONB;

INSERT INTO "customFieldTable" ("table", "module", "name")
VALUES 
  ('methodOperation', 'Items', 'Method Operation'),
  ('methodMaterial', 'Items', 'Method Material');

