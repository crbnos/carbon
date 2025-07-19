INSERT INTO "materialForm" ("id", "name", "createdBy") VALUES
  ('angle', 'Angle', 'system'),
  ('channel', 'Channel', 'system'),
  ('flatbar', 'Flat Bar', 'system'),
  ('filament', 'Filament', 'system'),
  ('hexbar', 'Hex Bar', 'system'),
  ('pellet', 'Pellet', 'system'),
  ('plate', 'Plate', 'system'),
  ('rectbar', 'Rectangular Bar', 'system'),
  ('recttube', 'Rectangular Tube', 'system'),
  ('roundbar', 'Round Bar', 'system'),
  ('roundtube', 'Round Tube', 'system'),
  ('squaretube', 'Square Tube', 'system'),
  ('sbeam', 'S-Beam', 'system'),
  ('sheet', 'Sheet', 'system'),
  ('squarebar', 'Square Bar', 'system'),
  ('tbar', 'T-Bar', 'system'),
  ('treadplate', 'Tread Plate', 'system'),
  ('wbeam', 'W-Beam', 'system'),
  ('widebar', 'Wide Bar', 'system');

INSERT INTO "materialSubstance" ("id", "name", "createdBy") VALUES
  ('steel', 'Steel', 'system'),
  ('aluminum', 'Aluminum', 'system'),
  ('brass', 'Brass', 'system'),
  ('bronze', 'Bronze', 'system'),
  ('copper', 'Copper', 'system'),
  ('inconel', 'Inconel', 'system'),
  ('magnesium', 'Magnesium', 'system'),
  ('monel', 'Monel', 'system'),
  ('nylon', 'Nylon', 'system'),
  ('plastic', 'Plastic', 'system'),
  ('pvc', 'PVC', 'system'),
  ('rubber', 'Rubber', 'system'),
  ('stainless', 'Stainless Steel', 'system'),
  ('titanium', 'Titanium', 'system'),
  ('tungsten', 'Tungsten', 'system'),
  ('zinc', 'Zinc', 'system'),
  ('zirconium', 'Zirconium', 'system');


CREATE TABLE "materialFinish" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "name" TEXT NOT NULL,
  "materialSubstanceId" TEXT NOT NULL,
  "companyId" TEXT,

  CONSTRAINT "materialFinish_materialSubstanceId_fkey" FOREIGN KEY ("materialSubstanceId") REFERENCES "materialSubstance"("id"),
  CONSTRAINT "materialFinish_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "materialFinish_name_companyId_unique" UNIQUE ("name", "companyId")
);

CREATE OR REPLACE VIEW "materialFinishes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    "materialFinish"."id",
    "materialFinish"."name",
    "materialFinish"."materialSubstanceId",
    "materialFinish"."companyId",
    "materialSubstance"."name" AS "substanceName"
  FROM "materialFinish"
  LEFT JOIN "materialSubstance" ON "materialFinish"."materialSubstanceId" = "materialSubstance"."id";

INSERT INTO "materialFinish" ("id", "name", "materialSubstanceId", "companyId") VALUES
  -- Steel finishes
  ('hr-steel', 'Hot Rolled', 'steel', null),
  ('cr-steel', 'Cold Rolled', 'steel', null),
  ('galv-steel', 'Galvanized', 'steel', null),
  ('pickled-steel', 'Pickled & Oiled', 'steel', null),
  ('black-steel', 'Black Oxide', 'steel', null),
  ('zinc-steel', 'Zinc Plated', 'steel', null),
  ('chrome-steel', 'Chrome Plated', 'steel', null),
  ('nickel-steel', 'Nickel Plated', 'steel', null),

  -- Aluminum finishes  
  ('mill-alum', 'Mill Finish', 'aluminum', null),
  ('clear-anod-alum', 'Clear Anodized', 'aluminum', null),
  ('black-anod-alum', 'Black Anodized', 'aluminum', null),
  ('gold-anod-alum', 'Gold Anodized', 'aluminum', null),
  ('brush-120-alum', '#120 Brushed', 'aluminum', null),
  ('brush-180-alum', '#180 Brushed', 'aluminum', null),
  ('brush-240-alum', '#240 Brushed', 'aluminum', null),

  -- Stainless finishes
  ('1-ss', '#1 Mill Finish', 'stainless', null),
  ('2b-ss', '#2B Bright Cold Rolled', 'stainless', null),
  ('2d-ss', '#2D Dull Cold Rolled', 'stainless', null),
  ('3-ss', '#3 Intermediate Polish', 'stainless', null),
  ('4-ss', '#4 Brushed', 'stainless', null),
  ('6-ss', '#6 Fine Satin', 'stainless', null),
  ('7-ss', '#7 High Reflective', 'stainless', null),
  ('8-ss', '#8 Mirror', 'stainless', null),
  ('ba-ss', 'BA (Bright Annealed)', 'stainless', null),

  -- Brass finishes
  ('brush-120-brass', '#120 Brushed', 'brass', null),
  ('brush-180-brass', '#180 Brushed', 'brass', null),
  ('brush-240-brass', '#240 Brushed', 'brass', null),
  ('mirror-brass', 'Mirror Polished', 'brass', null),
  ('satin-brass', 'Satin', 'brass', null),

  -- Bronze finishes
  ('brush-120-bronze', '#120 Brushed', 'bronze', null),
  ('brush-180-bronze', '#180 Brushed', 'bronze', null),
  ('mirror-bronze', 'Mirror Polished', 'bronze', null),
  ('satin-bronze', 'Satin', 'bronze', null),

  -- Copper finishes
  ('brush-120-copper', '#120 Brushed', 'copper', null),
  ('brush-180-copper', '#180 Brushed', 'copper', null),
  ('mirror-copper', 'Mirror Polished', 'copper', null),
  ('satin-copper', 'Satin', 'copper', null),

  -- Inconel finishes
  ('mill-inconel', 'Mill Finish', 'inconel', null),
  ('ground-32-inconel', '32 Ra Ground', 'inconel', null),
  ('ground-16-inconel', '16 Ra Ground', 'inconel', null),
  ('polish-inconel', 'Polished', 'inconel', null),

  -- Titanium finishes
  ('mill-ti', 'Mill Finish', 'titanium', null),
  ('blue-anod-ti', 'Blue Anodized', 'titanium', null),
  ('gold-anod-ti', 'Gold Anodized', 'titanium', null),
  ('purple-anod-ti', 'Purple Anodized', 'titanium', null),
  ('ground-32-ti', '32 Ra Ground', 'titanium', null),
  ('ground-16-ti', '16 Ra Ground', 'titanium', null);



CREATE TABLE "materialGrade" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "materialSubstanceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "companyId" TEXT,

  CONSTRAINT "materialGrade_materialSubstanceId_fkey" FOREIGN KEY ("materialSubstanceId") REFERENCES "materialSubstance"("id"),
  CONSTRAINT "materialGrade_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "materialGrade_name_companyId_unique" UNIQUE ("name", "companyId")
);

CREATE OR REPLACE VIEW "materialGrades" WITH(SECURITY_INVOKER=true) AS
  SELECT
    "materialGrade"."id",
    "materialGrade"."materialSubstanceId",
    "materialGrade"."name",
    "materialGrade"."companyId",
    "materialSubstance"."name" AS "substanceName"
  FROM "materialGrade"
  LEFT JOIN "materialSubstance" ON "materialGrade"."materialSubstanceId" = "materialSubstance"."id";

INSERT INTO "materialGrade" ("id", "materialSubstanceId", "name", "companyId") VALUES
  -- Steel grades
  ('1018', 'steel', '1018', null),
  ('1045', 'steel', '1045', null), 
  ('4140', 'steel', '4140', null),
  ('4340', 'steel', '4340', null),
  ('a36', 'steel', 'A36', null),
  ('1020', 'steel', '1020', null),
  ('1095', 'steel', '1095', null),
  ('4130', 'steel', '4130', null),
  ('8620', 'steel', '8620', null),
  ('d2', 'steel', 'D2', null),
  
  -- Aluminum grades
  ('6061', 'aluminum', '6061', null),
  ('2024', 'aluminum', '2024', null),
  ('5052', 'aluminum', '5052', null),
  ('7075', 'aluminum', '7075', null),
  ('3003', 'aluminum', '3003', null),
  ('5083', 'aluminum', '5083', null),
  ('6063', 'aluminum', '6063', null),
  ('7050', 'aluminum', '7050', null),
  ('2017', 'aluminum', '2017', null),
  ('5086', 'aluminum', '5086', null),

  -- Stainless grades  
  ('304', 'stainless', '304', null),
  ('316', 'stainless', '316', null),
  ('410', 'stainless', '410', null),
  ('17-4', 'stainless', '17-4', null),
  ('303', 'stainless', '303', null),
  ('316l', 'stainless', '316L', null),
  ('321', 'stainless', '321', null),
  ('347', 'stainless', '347', null),
  ('420', 'stainless', '420', null),
  ('440c', 'stainless', '440C', null),

  -- Brass grades
  ('360', 'brass', '360', null),
  ('385', 'brass', '385', null),
  ('230', 'brass', '230', null),
  ('260', 'brass', '260', null),
  ('353', 'brass', '353', null),
  ('365', 'brass', '365', null),
  
  -- Bronze grades
  ('544', 'bronze', '544', null),
  ('932', 'bronze', '932', null),
  ('954', 'bronze', '954', null),
  ('903', 'bronze', '903', null),
  ('905', 'bronze', '905', null),
  ('863', 'bronze', '863', null),
  
  -- Titanium grades
  ('gr1', 'titanium', 'Grade 1', null),
  ('gr2', 'titanium', 'Grade 2', null),
  ('gr3', 'titanium', 'Grade 3', null),
  ('gr4', 'titanium', 'Grade 4', null),
  ('gr5', 'titanium', 'Grade 5', null),
  ('gr7', 'titanium', 'Grade 7', null),
  ('gr9', 'titanium', 'Grade 9', null),
  
  -- Inconel grades
  ('600', 'inconel', '600', null),
  ('625', 'inconel', '625', null),
  ('718', 'inconel', '718', null),
  ('601', 'inconel', '601', null),
  ('617', 'inconel', '617', null),
  ('722', 'inconel', '722', null),
  ('725', 'inconel', '725', null),
  
  -- Copper grades
  ('110', 'copper', 'C110', null),
  ('101', 'copper', 'C101', null),
  ('102', 'copper', 'C102', null),
  ('145', 'copper', 'C145', null),
  
  -- Monel grades
  ('400', 'monel', '400', null),
  ('401', 'monel', '401', null),
  ('404', 'monel', '404', null),
  ('500', 'monel', '500', null);



CREATE TABLE "materialDimensions" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "materialFormId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  CONSTRAINT "materialDimensions_materialFormId_fkey" FOREIGN KEY ("materialFormId") REFERENCES "materialForm"("id"),
  CONSTRAINT "materialDimensions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id")
);
