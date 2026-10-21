-- Diamond tread plate (floor plate) for fabricators, and two sizes the seed and the
-- structural steel migration left out. Tread plate is a shape of its own: it is
-- bought and priced as floor plate (ASTM A786), named by its base thickness like
-- plate ('3/16"'), hot rolled. Names follow the seeded style so generated material
-- ids stay consistent ('A786-STEEL-HR-TREAD-3/16"'). All rows are system-wide
-- (companyId NULL).

INSERT INTO "materialForm" ("id", "name", "code", "createdBy") VALUES
  ('tread', 'Tread Plate', 'TREAD', 'system');

INSERT INTO "materialType" ("id", "name", "code", "materialSubstanceId", "materialFormId", "companyId") VALUES
  ('hot-rolled-steel-tread', 'Hot Rolled', 'HR', 'steel', 'tread', null);

INSERT INTO "materialGrade" ("id", "materialSubstanceId", "name", "companyId") VALUES
  ('steel-a786', 'steel', 'A786', null);

INSERT INTO "materialDimension" ("id", "materialFormId", "name", "isMetric", "companyId") VALUES
  -- Tread plate by base thickness
  ('tread-14ga', 'tread', '14 ga', false, null),
  ('tread-1-8', 'tread', '1/8"', false, null),
  ('tread-3-16', 'tread', '3/16"', false, null),
  ('tread-1-4', 'tread', '1/4"', false, null),
  ('tread-5-16', 'tread', '5/16"', false, null),
  ('tread-3-8', 'tread', '3/8"', false, null),
  -- Round bar between the seeded 1" and 1.25" (pins sized to a bought part's bore)
  ('roundbar-1-05', 'roundbar', '1.05"', false, null),
  -- Structural rectangular tube
  ('recttube-2-5x4x-188', 'recttube', '2.5" x 4" x .188"', false, null);
