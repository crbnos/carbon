INSERT INTO "materialType" ("id", "name", "code", "materialSubstanceId", "materialFormId", "companyId") VALUES
  ('hrpo-steel-sheet', 'HRPO', 'HRPO', 'steel', 'sheet', null),
  ('hrpo-steel-plate', 'HRPO', 'HRPO', 'steel', 'plate', null),
  ('hrpo-stainless-sheet', 'HRPO', 'HRPO', 'stainless', 'sheet', null),
  ('hrpo-stainless-plate', 'HRPO', 'HRPO', 'stainless', 'plate', null),
  ('galvanized-steel-plate', 'Galvanized', 'GA', 'steel', 'plate', null),
  ('galvannealed-steel-sheet', 'Galvannealed', 'GN', 'steel', 'sheet', null),
  ('galvannealed-steel-plate', 'Galvannealed', 'GN', 'steel', 'plate', null);


UPDATE "material" SET "materialTypeId" = 'hrpo-steel-plate' WHERE "id" = 'pickled-oiled-steel-plate';
UPDATE "material" SET "materialTypeId" = 'hrpo-stainless-sheet' WHERE "id" = 'pickled-stainless-plate';

DELETE FROM "materialType" WHERE "id" = 'pickled-oiled-steel-plate';
DELETE FROM "materialType" WHERE "id" = 'pickled-stainless-plate';

INSERT INTO "materialGrade" ("id", "materialSubstanceId", "name", "companyId") VALUES
('steel-a653', 'steel', 'A653', null);