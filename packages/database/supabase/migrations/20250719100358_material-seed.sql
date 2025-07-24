ALTER TABLE "companySettings" ADD COLUMN "materialGeneratedIds" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "companySettings" ADD COLUMN "useMetric" BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;

-- Set materialGeneratedIds to false for all existing companies
UPDATE "companySettings" SET "materialGeneratedIds" = false;


INSERT INTO "materialForm" ("id", "name", "createdBy") VALUES
  ('angle', 'Angle', 'system'),
  ('billet', 'Billet', 'system'),
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
  CONSTRAINT "materialFinish_name_companyId_unique" UNIQUE ("materialSubstanceId", "name", "companyId")
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
 

  -- Stainless finishes
  ('1-ss', '#1', 'stainless', null),
  ('2b-ss', '#2B', 'stainless', null),
  ('2d-ss', '#2D', 'stainless', null),
  ('3-ss', '#3', 'stainless', null),
  ('4-ss', '#4', 'stainless', null),
  ('6-ss', '#6', 'stainless', null),
  ('7-ss', '#7', 'stainless', null),
  ('8-ss', '#8', 'stainless', null),
  ('ba-ss', 'BA', 'stainless', null),

  -- Brass finishes
  ('brush-120-brass', '#120', 'brass', null),
  ('brush-180-brass', '#180', 'brass', null),
  ('brush-240-brass', '#240', 'brass', null),
  ('mirror-brass', 'Mirror', 'brass', null),
  ('satin-brass', 'Satin', 'brass', null),

  -- Bronze finishes
  ('brush-120-bronze', '#120', 'bronze', null),
  ('brush-180-bronze', '#180', 'bronze', null),
  ('mirror-bronze', 'Mirror', 'bronze', null),
  ('satin-bronze', 'Satin', 'bronze', null),

  -- Copper finishes
  ('brush-120-copper', '#120', 'copper', null),
  ('brush-180-copper', '#180', 'copper', null),
  ('mirror-copper', 'Mirror', 'copper', null),
  ('satin-copper', 'Satin', 'copper', null),

  -- Inconel finishes
  ('mill-inconel', 'Mill', 'inconel', null),
  ('ground-32-inconel', '32 Ra Ground', 'inconel', null),
  ('ground-16-inconel', '16 Ra Ground', 'inconel', null),
  ('polish-inconel', 'Polish', 'inconel', null),

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
  CONSTRAINT "materialGrade_name_companyId_unique" UNIQUE ("materialSubstanceId", "name", "companyId")
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


CREATE TABLE "materialType" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "name" TEXT NOT NULL,
  "materialSubstanceId" TEXT NOT NULL,
  "materialFormId" TEXT NOT NULL,
  "companyId" TEXT,

  CONSTRAINT "materialType_materialSubstanceId_fkey" FOREIGN KEY ("materialSubstanceId") REFERENCES "materialSubstance"("id"),
  CONSTRAINT "materialType_materialFormId_fkey" FOREIGN KEY ("materialFormId") REFERENCES "materialForm"("id"),
  CONSTRAINT "materialType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "materialType_name_companyId_unique" UNIQUE ("materialSubstanceId", "materialFormId", "name", "companyId")
);

CREATE OR REPLACE VIEW "materialTypes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    "materialType"."id",
    "materialType"."name",
    "materialType"."materialSubstanceId",
    "materialType"."materialFormId", 
    "materialType"."companyId",
    "materialSubstance"."name" AS "substanceName",
    "materialForm"."name" AS "formName"
  FROM "materialType"
  LEFT JOIN "materialSubstance" ON "materialType"."materialSubstanceId" = "materialSubstance"."id"
  LEFT JOIN "materialForm" ON "materialType"."materialFormId" = "materialForm"."id";

INSERT INTO "materialType" ("id", "name", "materialSubstanceId", "materialFormId", "companyId") VALUES
  -- Steel Plate types
  ('hot-rolled-steel-plate', 'Hot Rolled', 'steel', 'plate', null),
  ('cold-rolled-steel-plate', 'Cold Rolled', 'steel', 'plate', null),
  ('pickled-oiled-steel-plate', 'Pickled & Oiled', 'steel', 'plate', null),
  ('normalized-steel-plate', 'Normalized', 'steel', 'plate', null),
  
  -- Aluminum Round Tube types
  ('seamless-aluminum-roundtube', 'Seamless', 'aluminum', 'roundtube', null),
  ('structural-aluminum-roundtube', 'Structural', 'aluminum', 'roundtube', null),
  ('drawn-aluminum-roundtube', 'Drawn', 'aluminum', 'roundtube', null),
  
  -- Steel Round Tube types
  ('seamless-steel-roundtube', 'Seamless', 'steel', 'roundtube', null),
  ('welded-steel-roundtube', 'Welded', 'steel', 'roundtube', null),
  ('dom-steel-roundtube', 'DOM (Drawn Over Mandrel)', 'steel', 'roundtube', null),
  
  -- Stainless Steel types
  ('annealed-stainless-plate', 'Annealed', 'stainless', 'plate', null),
  ('pickled-stainless-plate', 'Pickled', 'stainless', 'plate', null),
  ('solution-annealed-stainless-plate', 'Solution Annealed', 'stainless', 'plate', null),
  
  -- Aluminum Bar types
  ('extruded-aluminum-roundbar', 'Extruded', 'aluminum', 'roundbar', null),
  ('cold-finished-aluminum-roundbar', 'Cold Finished', 'aluminum', 'roundbar', null),
  ('heat-treated-aluminum-roundbar', 'Heat Treated', 'aluminum', 'roundbar', null),
  
  -- Steel Bar types
  ('hot-rolled-steel-roundbar', 'Hot Rolled', 'steel', 'roundbar', null),
  ('cold-finished-steel-roundbar', 'Cold Finished', 'steel', 'roundbar', null),
  ('ground-steel-roundbar', 'Ground', 'steel', 'roundbar', null),
  
  -- Sheet types
  ('hot-rolled-steel-sheet', 'Hot Rolled', 'steel', 'sheet', null),
  ('cold-rolled-steel-sheet', 'Cold Rolled', 'steel', 'sheet', null),
  ('galvanized-steel-sheet', 'Galvanized', 'steel', 'sheet', null),
  
  -- Aluminum Sheet types
  ('rolled-aluminum-sheet', 'Rolled', 'aluminum', 'sheet', null),
  ('treadplate-aluminum-sheet', 'Tread Plate', 'aluminum', 'sheet', null);



CREATE TABLE "materialDimension" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "materialFormId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isMetric" BOOLEAN NOT NULL DEFAULT FALSE,
  "companyId" TEXT,

  CONSTRAINT "materialDimensions_materialFormId_fkey" FOREIGN KEY ("materialFormId") REFERENCES "materialForm"("id"),
  CONSTRAINT "materialDimensions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "materialDimensions_name_companyId_unique" UNIQUE ("materialFormId", "name", "companyId")
);

CREATE OR REPLACE VIEW "materialDimensions" WITH(SECURITY_INVOKER=true) AS
  SELECT
    "materialDimension"."id",
    "materialDimension"."materialFormId",
    "materialDimension"."name",
    "materialDimension"."isMetric",
    "materialDimension"."companyId",
    "materialForm"."name" AS "formName"
  FROM "materialDimension"
  LEFT JOIN "materialForm" ON "materialDimension"."materialFormId" = "materialForm"."id";

INSERT INTO "materialDimension" ("id", "materialFormId", "name", "isMetric", "companyId") VALUES
  -- Sheet dimensions (thicknesses) - Imperial
  ('sheet-0-010', 'sheet', '0.010"', false, null),
  ('sheet-0-016', 'sheet', '0.016"', false, null),
  ('sheet-0-018', 'sheet', '0.018"', false, null),
  ('sheet-0-020', 'sheet', '0.020"', false, null),
  ('sheet-0-024', 'sheet', '0.024"', false, null),
  ('sheet-0-025', 'sheet', '0.025"', false, null),
  ('sheet-0-030', 'sheet', '0.030"', false, null),
  ('sheet-0-032', 'sheet', '0.032"', false, null),
  ('sheet-0-036', 'sheet', '0.036"', false, null),
  ('sheet-0-040', 'sheet', '0.040"', false, null),
  ('sheet-0-048', 'sheet', '0.048"', false, null),
  ('sheet-0-050', 'sheet', '0.050"', false, null),
  ('sheet-0-060', 'sheet', '0.060"', false, null),
  ('sheet-0-063', 'sheet', '0.063"', false, null),
  ('sheet-0-064', 'sheet', '0.064"', false, null),
  ('sheet-0-075', 'sheet', '0.075"', false, null),
  ('sheet-0-080', 'sheet', '0.080"', false, null),
  ('sheet-0-090', 'sheet', '0.090"', false, null),
  ('sheet-0-105', 'sheet', '0.105"', false, null),
  ('sheet-0-114', 'sheet', '0.114"', false, null),
  ('sheet-0-120', 'sheet', '0.120"', false, null),
  ('sheet-0-129', 'sheet', '0.129"', false, null),
  ('sheet-0-134', 'sheet', '0.134"', false, null),
  ('sheet-0-160', 'sheet', '0.160"', false, null),
  ('sheet-0-187', 'sheet', '0.187"', false, null),
  ('sheet-1-32', 'sheet', '1/32"', false, null),
  ('sheet-3-64', 'sheet', '3/64"', false, null),
  ('sheet-1-16', 'sheet', '1/16"', false, null),
  ('sheet-5-64', 'sheet', '5/64"', false, null),
  ('sheet-3-32', 'sheet', '3/32"', false, null),
  
  -- Sheet dimensions (metric thicknesses)
  ('sheet-0-5mm', 'sheet', '0.5mm', true, null),
  ('sheet-0-8mm', 'sheet', '0.8mm', true, null),
  ('sheet-1mm', 'sheet', '1.0mm', true, null),
  ('sheet-1-2mm', 'sheet', '1.2mm', true, null),
  ('sheet-1-5mm', 'sheet', '1.5mm', true, null),
  ('sheet-2mm', 'sheet', '2.0mm', true, null),
  ('sheet-2-5mm', 'sheet', '2.5mm', true, null),
  ('sheet-3mm', 'sheet', '3.0mm', true, null),
  ('sheet-4mm', 'sheet', '4.0mm', true, null),
  ('sheet-5mm', 'sheet', '5.0mm', true, null),
  
  -- Plate dimensions (thicknesses) - Imperial
  ('plate-1-8', 'plate', '1/8"', false, null),
  ('plate-3-16', 'plate', '3/16"', false, null),
  ('plate-1-4', 'plate', '1/4"', false, null),
  ('plate-5-16', 'plate', '5/16"', false, null),
  ('plate-3-8', 'plate', '3/8"', false, null),
  ('plate-1-2', 'plate', '1/2"', false, null),
  ('plate-5-8', 'plate', '5/8"', false, null),
  ('plate-3-4', 'plate', '3/4"', false, null),
  ('plate-1', 'plate', '1"', false, null),
  ('plate-1-25', 'plate', '1.25"', false, null),
  ('plate-1-5', 'plate', '1.5"', false, null),
  ('plate-2', 'plate', '2"', false, null),
  
  -- Plate dimensions (metric thicknesses)
  ('plate-6mm', 'plate', '6mm', true, null),
  ('plate-8mm', 'plate', '8mm', true, null),
  ('plate-10mm', 'plate', '10mm', true, null),
  ('plate-12mm', 'plate', '12mm', true, null),
  ('plate-15mm', 'plate', '15mm', true, null),
  ('plate-20mm', 'plate', '20mm', true, null),
  ('plate-25mm', 'plate', '25mm', true, null),
  ('plate-30mm', 'plate', '30mm', true, null),
  ('plate-40mm', 'plate', '40mm', true, null),
  ('plate-50mm', 'plate', '50mm', true, null),
  
  -- Round bar dimensions (diameters) - Imperial
  ('roundbar-1-8', 'roundbar', '1/8"', false, null),
  ('roundbar-3-16', 'roundbar', '3/16"', false, null),
  ('roundbar-1-4', 'roundbar', '1/4"', false, null),
  ('roundbar-5-16', 'roundbar', '5/16"', false, null),
  ('roundbar-3-8', 'roundbar', '3/8"', false, null),
  ('roundbar-1-2', 'roundbar', '1/2"', false, null),
  ('roundbar-5-8', 'roundbar', '5/8"', false, null),
  ('roundbar-3-4', 'roundbar', '3/4"', false, null),
  ('roundbar-7-8', 'roundbar', '7/8"', false, null),
  ('roundbar-1', 'roundbar', '1"', false, null),
  ('roundbar-1-25', 'roundbar', '1.25"', false, null),
  ('roundbar-1-5', 'roundbar', '1.5"', false, null),
  ('roundbar-2', 'roundbar', '2"', false, null),
  ('roundbar-2-5', 'roundbar', '2.5"', false, null),
  ('roundbar-3', 'roundbar', '3"', false, null),
  ('roundbar-4', 'roundbar', '4"', false, null),
  
  -- Round bar dimensions (metric diameters)
  ('roundbar-3mm', 'roundbar', '3mm', true, null),
  ('roundbar-4mm', 'roundbar', '4mm', true, null),
  ('roundbar-5mm', 'roundbar', '5mm', true, null),
  ('roundbar-6mm', 'roundbar', '6mm', true, null),
  ('roundbar-8mm', 'roundbar', '8mm', true, null),
  ('roundbar-10mm', 'roundbar', '10mm', true, null),
  ('roundbar-12mm', 'roundbar', '12mm', true, null),
  ('roundbar-15mm', 'roundbar', '15mm', true, null),
  ('roundbar-16mm', 'roundbar', '16mm', true, null),
  ('roundbar-20mm', 'roundbar', '20mm', true, null),
  ('roundbar-25mm', 'roundbar', '25mm', true, null),
  ('roundbar-30mm', 'roundbar', '30mm', true, null),
  ('roundbar-35mm', 'roundbar', '35mm', true, null),
  ('roundbar-40mm', 'roundbar', '40mm', true, null),
  ('roundbar-50mm', 'roundbar', '50mm', true, null),
  ('roundbar-60mm', 'roundbar', '60mm', true, null),
  ('roundbar-80mm', 'roundbar', '80mm', true, null),
  ('roundbar-100mm', 'roundbar', '100mm', true, null),
  
  -- Square bar dimensions - Imperial
  ('squarebar-1-8', 'squarebar', '1/8"', false, null),
  ('squarebar-3-16', 'squarebar', '3/16"', false, null),
  ('squarebar-1-4', 'squarebar', '1/4"', false, null),
  ('squarebar-5-16', 'squarebar', '5/16"', false, null),
  ('squarebar-3-8', 'squarebar', '3/8"', false, null),
  ('squarebar-1-2', 'squarebar', '1/2"', false, null),
  ('squarebar-5-8', 'squarebar', '5/8"', false, null),
  ('squarebar-3-4', 'squarebar', '3/4"', false, null),
  ('squarebar-1', 'squarebar', '1"', false, null),
  ('squarebar-1-25', 'squarebar', '1.25"', false, null),
  ('squarebar-1-5', 'squarebar', '1.5"', false, null),
  ('squarebar-2', 'squarebar', '2"', false, null),
  
  -- Square bar dimensions - Metric
  ('squarebar-3mm', 'squarebar', '3mm', true, null),
  ('squarebar-4mm', 'squarebar', '4mm', true, null),
  ('squarebar-5mm', 'squarebar', '5mm', true, null),
  ('squarebar-6mm', 'squarebar', '6mm', true, null),
  ('squarebar-8mm', 'squarebar', '8mm', true, null),
  ('squarebar-10mm', 'squarebar', '10mm', true, null),
  ('squarebar-12mm', 'squarebar', '12mm', true, null),
  ('squarebar-15mm', 'squarebar', '15mm', true, null),
  ('squarebar-20mm', 'squarebar', '20mm', true, null),
  ('squarebar-25mm', 'squarebar', '25mm', true, null),
  ('squarebar-30mm', 'squarebar', '30mm', true, null),
  ('squarebar-40mm', 'squarebar', '40mm', true, null),
  ('squarebar-50mm', 'squarebar', '50mm', true, null),
  
  -- Hex bar dimensions - Imperial
  ('hexbar-1-4', 'hexbar', '1/4"', false, null),
  ('hexbar-5-16', 'hexbar', '5/16"', false, null),
  ('hexbar-3-8', 'hexbar', '3/8"', false, null),
  ('hexbar-1-2', 'hexbar', '1/2"', false, null),
  ('hexbar-5-8', 'hexbar', '5/8"', false, null),
  ('hexbar-3-4', 'hexbar', '3/4"', false, null),
  ('hexbar-7-8', 'hexbar', '7/8"', false, null),
  ('hexbar-1', 'hexbar', '1"', false, null),
  ('hexbar-1-25', 'hexbar', '1.25"', false, null),
  ('hexbar-1-5', 'hexbar', '1.5"', false, null),
  
  -- Hex bar dimensions - Metric
  ('hexbar-5mm', 'hexbar', '5mm', true, null),
  ('hexbar-6mm', 'hexbar', '6mm', true, null),
  ('hexbar-8mm', 'hexbar', '8mm', true, null),
  ('hexbar-10mm', 'hexbar', '10mm', true, null),
  ('hexbar-12mm', 'hexbar', '12mm', true, null),
  ('hexbar-15mm', 'hexbar', '15mm', true, null),
  ('hexbar-17mm', 'hexbar', '17mm', true, null),
  ('hexbar-19mm', 'hexbar', '19mm', true, null),
  ('hexbar-22mm', 'hexbar', '22mm', true, null),
  ('hexbar-24mm', 'hexbar', '24mm', true, null),
  ('hexbar-27mm', 'hexbar', '27mm', true, null),
  ('hexbar-30mm', 'hexbar', '30mm', true, null),
  ('hexbar-32mm', 'hexbar', '32mm', true, null),
  ('hexbar-36mm', 'hexbar', '36mm', true, null),
  ('hexbar-41mm', 'hexbar', '41mm', true, null),
  
  -- Flat bar dimensions (thickness x width) - Imperial
  ('flatbar-1-8x1-2', 'flatbar', '1/8" x 1/2"', false, null),
  ('flatbar-1-8x3-4', 'flatbar', '1/8" x 3/4"', false, null),
  ('flatbar-1-8x1', 'flatbar', '1/8" x 1"', false, null),
  ('flatbar-3-16x1-2', 'flatbar', '3/16" x 1/2"', false, null),
  ('flatbar-3-16x3-4', 'flatbar', '3/16" x 3/4"', false, null),
  ('flatbar-3-16x1', 'flatbar', '3/16" x 1"', false, null),
  ('flatbar-1-4x1-2', 'flatbar', '1/4" x 1/2"', false, null),
  ('flatbar-1-4x3-4', 'flatbar', '1/4" x 3/4"', false, null),
  ('flatbar-1-4x1', 'flatbar', '1/4" x 1"', false, null),
  ('flatbar-1-4x1-5', 'flatbar', '1/4" x 1.5"', false, null),
  ('flatbar-1-4x2', 'flatbar', '1/4" x 2"', false, null),
  ('flatbar-3-8x1', 'flatbar', '3/8" x 1"', false, null),
  ('flatbar-3-8x1-5', 'flatbar', '3/8" x 1.5"', false, null),
  ('flatbar-3-8x2', 'flatbar', '3/8" x 2"', false, null),
  ('flatbar-1-2x1', 'flatbar', '1/2" x 1"', false, null),
  ('flatbar-1-2x1-5', 'flatbar', '1/2" x 1.5"', false, null),
  ('flatbar-1-2x2', 'flatbar', '1/2" x 2"', false, null),
  ('flatbar-1-2x3', 'flatbar', '1/2" x 3"', false, null),
  
  -- Flat bar dimensions (thickness x width) - Metric
  ('flatbar-3x12', 'flatbar', '3mm x 12mm', true, null),
  ('flatbar-3x15', 'flatbar', '3mm x 15mm', true, null),
  ('flatbar-3x20', 'flatbar', '3mm x 20mm', true, null),
  ('flatbar-3x25', 'flatbar', '3mm x 25mm', true, null),
  ('flatbar-4x20', 'flatbar', '4mm x 20mm', true, null),
  ('flatbar-4x25', 'flatbar', '4mm x 25mm', true, null),
  ('flatbar-4x30', 'flatbar', '4mm x 30mm', true, null),
  ('flatbar-5x20', 'flatbar', '5mm x 20mm', true, null),
  ('flatbar-5x25', 'flatbar', '5mm x 25mm', true, null),
  ('flatbar-5x30', 'flatbar', '5mm x 30mm', true, null),
  ('flatbar-5x40', 'flatbar', '5mm x 40mm', true, null),
  ('flatbar-6x25', 'flatbar', '6mm x 25mm', true, null),
  ('flatbar-6x30', 'flatbar', '6mm x 30mm', true, null),
  ('flatbar-6x40', 'flatbar', '6mm x 40mm', true, null),
  ('flatbar-6x50', 'flatbar', '6mm x 50mm', true, null),
  ('flatbar-8x25', 'flatbar', '8mm x 25mm', true, null),
  ('flatbar-8x30', 'flatbar', '8mm x 30mm', true, null),
  ('flatbar-8x40', 'flatbar', '8mm x 40mm', true, null),
  ('flatbar-8x50', 'flatbar', '8mm x 50mm', true, null),
  ('flatbar-10x30', 'flatbar', '10mm x 30mm', true, null),
  ('flatbar-10x40', 'flatbar', '10mm x 40mm', true, null),
  ('flatbar-10x50', 'flatbar', '10mm x 50mm', true, null),
  ('flatbar-10x60', 'flatbar', '10mm x 60mm', true, null),
  ('flatbar-12x40', 'flatbar', '12mm x 40mm', true, null),
  ('flatbar-12x50', 'flatbar', '12mm x 50mm', true, null),
  ('flatbar-12x60', 'flatbar', '12mm x 60mm', true, null),
  ('flatbar-12x80', 'flatbar', '12mm x 80mm', true, null),
  
  -- Round tube dimensions (OD x wall thickness) - Imperial
  ('roundtube-1-2x049', 'roundtube', '1/2" x .049"', false, null),
  ('roundtube-5-8x049', 'roundtube', '5/8" x .049"', false, null),
  ('roundtube-3-4x049', 'roundtube', '3/4" x .049"', false, null),
  ('roundtube-7-8x049', 'roundtube', '7/8" x .049"', false, null),
  ('roundtube-1x049', 'roundtube', '1" x .049"', false, null),
  ('roundtube-1x065', 'roundtube', '1" x .065"', false, null),
  ('roundtube-1-25x049', 'roundtube', '1.25" x .049"', false, null),
  ('roundtube-1-25x065', 'roundtube', '1.25" x .065"', false, null),
  ('roundtube-1-5x049', 'roundtube', '1.5" x .049"', false, null),
  ('roundtube-1-5x065', 'roundtube', '1.5" x .065"', false, null),
  ('roundtube-2x049', 'roundtube', '2" x .049"', false, null),
  ('roundtube-2x065', 'roundtube', '2" x .065"', false, null),
  ('roundtube-2x083', 'roundtube', '2" x .083"', false, null),
  
  -- Round tube dimensions (OD x wall thickness) - Metric
  ('roundtube-12x1', 'roundtube', '12mm x 1.0mm', true, null),
  ('roundtube-12x1-5', 'roundtube', '12mm x 1.5mm', true, null),
  ('roundtube-15x1', 'roundtube', '15mm x 1.0mm', true, null),
  ('roundtube-15x1-5', 'roundtube', '15mm x 1.5mm', true, null),
  ('roundtube-16x1', 'roundtube', '16mm x 1.0mm', true, null),
  ('roundtube-16x1-5', 'roundtube', '16mm x 1.5mm', true, null),
  ('roundtube-16x2', 'roundtube', '16mm x 2.0mm', true, null),
  ('roundtube-20x1', 'roundtube', '20mm x 1.0mm', true, null),
  ('roundtube-20x1-5', 'roundtube', '20mm x 1.5mm', true, null),
  ('roundtube-20x2', 'roundtube', '20mm x 2.0mm', true, null),
  ('roundtube-25x1-5', 'roundtube', '25mm x 1.5mm', true, null),
  ('roundtube-25x2', 'roundtube', '25mm x 2.0mm', true, null),
  ('roundtube-30x2', 'roundtube', '30mm x 2.0mm', true, null),
  ('roundtube-30x2-5', 'roundtube', '30mm x 2.5mm', true, null),
  ('roundtube-35x2', 'roundtube', '35mm x 2.0mm', true, null),
  ('roundtube-35x2-5', 'roundtube', '35mm x 2.5mm', true, null),
  ('roundtube-40x2', 'roundtube', '40mm x 2.0mm', true, null),
  ('roundtube-40x2-5', 'roundtube', '40mm x 2.5mm', true, null),
  ('roundtube-40x3', 'roundtube', '40mm x 3.0mm', true, null),
  ('roundtube-50x2-5', 'roundtube', '50mm x 2.5mm', true, null),
  ('roundtube-50x3', 'roundtube', '50mm x 3.0mm', true, null),
  ('roundtube-60x3', 'roundtube', '60mm x 3.0mm', true, null),
  ('roundtube-60x4', 'roundtube', '60mm x 4.0mm', true, null),
  
  -- Square tube dimensions (size x wall thickness) - Imperial
  ('squaretube-1-2x049', 'squaretube', '1/2" x .049"', false, null),
  ('squaretube-5-8x049', 'squaretube', '5/8" x .049"', false, null),
  ('squaretube-3-4x049', 'squaretube', '3/4" x .049"', false, null),
  ('squaretube-1x049', 'squaretube', '1" x .049"', false, null),
  ('squaretube-1x065', 'squaretube', '1" x .065"', false, null),
  ('squaretube-1-25x049', 'squaretube', '1.25" x .049"', false, null),
  ('squaretube-1-25x065', 'squaretube', '1.25" x .065"', false, null),
  ('squaretube-1-5x049', 'squaretube', '1.5" x .049"', false, null),
  ('squaretube-1-5x065', 'squaretube', '1.5" x .065"', false, null),
  ('squaretube-2x049', 'squaretube', '2" x .049"', false, null),
  ('squaretube-2x065', 'squaretube', '2" x .065"', false, null),
  ('squaretube-2x083', 'squaretube', '2" x .083"', false, null),
  
  -- Square tube dimensions (size x wall thickness) - Metric
  ('squaretube-15x1', 'squaretube', '15mm x 1.0mm', true, null),
  ('squaretube-15x1-5', 'squaretube', '15mm x 1.5mm', true, null),
  ('squaretube-20x1', 'squaretube', '20mm x 1.0mm', true, null),
  ('squaretube-20x1-5', 'squaretube', '20mm x 1.5mm', true, null),
  ('squaretube-20x2', 'squaretube', '20mm x 2.0mm', true, null),
  ('squaretube-25x1-5', 'squaretube', '25mm x 1.5mm', true, null),
  ('squaretube-25x2', 'squaretube', '25mm x 2.0mm', true, null),
  ('squaretube-30x2', 'squaretube', '30mm x 2.0mm', true, null),
  ('squaretube-30x2-5', 'squaretube', '30mm x 2.5mm', true, null),
  ('squaretube-35x2', 'squaretube', '35mm x 2.0mm', true, null),
  ('squaretube-35x2-5', 'squaretube', '35mm x 2.5mm', true, null),
  ('squaretube-40x2', 'squaretube', '40mm x 2.0mm', true, null),
  ('squaretube-40x2-5', 'squaretube', '40mm x 2.5mm', true, null),
  ('squaretube-40x3', 'squaretube', '40mm x 3.0mm', true, null),
  ('squaretube-50x2-5', 'squaretube', '50mm x 2.5mm', true, null),
  ('squaretube-50x3', 'squaretube', '50mm x 3.0mm', true, null),
  ('squaretube-60x3', 'squaretube', '60mm x 3.0mm', true, null),
  ('squaretube-60x4', 'squaretube', '60mm x 4.0mm', true, null),
  ('squaretube-80x4', 'squaretube', '80mm x 4.0mm', true, null),
  ('squaretube-100x4', 'squaretube', '100mm x 4.0mm', true, null),
  
  -- Rectangular tube dimensions (width x height x wall thickness) - Imperial
  ('recttube-1x2x049', 'recttube', '1" x 2" x .049"', false, null),
  ('recttube-1x2x065', 'recttube', '1" x 2" x .065"', false, null),
  ('recttube-1-5x2x049', 'recttube', '1.5" x 2" x .049"', false, null),
  ('recttube-1-5x2x065', 'recttube', '1.5" x 2" x .065"', false, null),
  ('recttube-2x3x049', 'recttube', '2" x 3" x .049"', false, null),
  ('recttube-2x3x065', 'recttube', '2" x 3" x .065"', false, null),
  ('recttube-2x4x049', 'recttube', '2" x 4" x .049"', false, null),
  ('recttube-2x4x065', 'recttube', '2" x 4" x .065"', false, null),
  ('recttube-3x4x065', 'recttube', '3" x 4" x .065"', false, null),
  
  -- Rectangular tube dimensions (width x height x wall thickness) - Metric
  ('recttube-20x30x1-5', 'recttube', '20mm x 30mm x 1.5mm', true, null),
  ('recttube-20x30x2', 'recttube', '20mm x 30mm x 2.0mm', true, null),
  ('recttube-20x40x1-5', 'recttube', '20mm x 40mm x 1.5mm', true, null),
  ('recttube-20x40x2', 'recttube', '20mm x 40mm x 2.0mm', true, null),
  ('recttube-25x40x2', 'recttube', '25mm x 40mm x 2.0mm', true, null),
  ('recttube-25x50x2', 'recttube', '25mm x 50mm x 2.0mm', true, null),
  ('recttube-30x40x2', 'recttube', '30mm x 40mm x 2.0mm', true, null),
  ('recttube-30x50x2', 'recttube', '30mm x 50mm x 2.0mm', true, null),
  ('recttube-30x60x2-5', 'recttube', '30mm x 60mm x 2.5mm', true, null),
  ('recttube-40x60x2-5', 'recttube', '40mm x 60mm x 2.5mm', true, null),
  ('recttube-40x80x3', 'recttube', '40mm x 80mm x 3.0mm', true, null),
  ('recttube-50x80x3', 'recttube', '50mm x 80mm x 3.0mm', true, null),
  ('recttube-50x100x3', 'recttube', '50mm x 100mm x 3.0mm', true, null),
  ('recttube-60x100x4', 'recttube', '60mm x 100mm x 4.0mm', true, null),
  ('recttube-80x120x4', 'recttube', '80mm x 120mm x 4.0mm', true, null),
  
  -- Rectangular bar dimensions (thickness x width) - Imperial
  ('rectbar-1-8x1-2', 'rectbar', '1/8" x 1/2"', false, null),
  ('rectbar-1-4x1-2', 'rectbar', '1/4" x 1/2"', false, null),
  ('rectbar-1-4x3-4', 'rectbar', '1/4" x 3/4"', false, null),
  ('rectbar-1-4x1', 'rectbar', '1/4" x 1"', false, null),
  ('rectbar-3-8x3-4', 'rectbar', '3/8" x 3/4"', false, null),
  ('rectbar-3-8x1', 'rectbar', '3/8" x 1"', false, null),
  ('rectbar-1-2x1', 'rectbar', '1/2" x 1"', false, null),
  ('rectbar-1-2x1-5', 'rectbar', '1/2" x 1.5"', false, null),
  ('rectbar-1-2x2', 'rectbar', '1/2" x 2"', false, null),
  
  -- Rectangular bar dimensions (thickness x width) - Metric
  ('rectbar-3x12', 'rectbar', '3mm x 12mm', true, null),
  ('rectbar-4x12', 'rectbar', '4mm x 12mm', true, null),
  ('rectbar-5x15', 'rectbar', '5mm x 15mm', true, null),
  ('rectbar-5x20', 'rectbar', '5mm x 20mm', true, null),
  ('rectbar-6x20', 'rectbar', '6mm x 20mm', true, null),
  ('rectbar-6x25', 'rectbar', '6mm x 25mm', true, null),
  ('rectbar-8x25', 'rectbar', '8mm x 25mm', true, null),
  ('rectbar-8x30', 'rectbar', '8mm x 30mm', true, null),
  ('rectbar-10x30', 'rectbar', '10mm x 30mm', true, null),
  ('rectbar-10x40', 'rectbar', '10mm x 40mm', true, null),
  ('rectbar-12x40', 'rectbar', '12mm x 40mm', true, null),
  ('rectbar-12x50', 'rectbar', '12mm x 50mm', true, null),
  ('rectbar-15x50', 'rectbar', '15mm x 50mm', true, null),
  
  -- Angle dimensions (leg x leg x thickness) - Imperial
  ('angle-1-2x1-2x1-8', 'angle', '1/2" x 1/2" x 1/8"', false, null),
  ('angle-5-8x5-8x1-8', 'angle', '5/8" x 5/8" x 1/8"', false, null),
  ('angle-3-4x3-4x1-8', 'angle', '3/4" x 3/4" x 1/8"', false, null),
  ('angle-1x1x1-8', 'angle', '1" x 1" x 1/8"', false, null),
  ('angle-1x1x3-16', 'angle', '1" x 1" x 3/16"', false, null),
  ('angle-1x1x1-4', 'angle', '1" x 1" x 1/4"', false, null),
  ('angle-1-25x1-25x1-8', 'angle', '1.25" x 1.25" x 1/8"', false, null),
  ('angle-1-25x1-25x3-16', 'angle', '1.25" x 1.25" x 3/16"', false, null),
  ('angle-1-25x1-25x1-4', 'angle', '1.25" x 1.25" x 1/4"', false, null),
  ('angle-1-5x1-5x1-8', 'angle', '1.5" x 1.5" x 1/8"', false, null),
  ('angle-1-5x1-5x3-16', 'angle', '1.5" x 1.5" x 3/16"', false, null),
  ('angle-1-5x1-5x1-4', 'angle', '1.5" x 1.5" x 1/4"', false, null),
  ('angle-1-75x1-75x1-8', 'angle', '1.75" x 1.75" x 1/8"', false, null),
  ('angle-1-75x1-75x3-16', 'angle', '1.75" x 1.75" x 3/16"', false, null),
  ('angle-1-75x1-75x1-4', 'angle', '1.75" x 1.75" x 1/4"', false, null),
  ('angle-2x1-5x1-8', 'angle', '2" x 1.5" x 1/8"', false, null),
  ('angle-2x1-5x3-16', 'angle', '2" x 1.5" x 3/16"', false, null),
  ('angle-2x1-5x1-4', 'angle', '2" x 1.5" x 1/4"', false, null),
  ('angle-2x2x1-8', 'angle', '2" x 2" x 1/8"', false, null),
  ('angle-2x2x3-16', 'angle', '2" x 2" x 3/16"', false, null),
  ('angle-2x2x1-4', 'angle', '2" x 2" x 1/4"', false, null),
  ('angle-2x2x3-8', 'angle', '2" x 2" x 3/8"', false, null),
  ('angle-2-5x1-5x3-16', 'angle', '2.5" x 1.5" x 3/16"', false, null),
  ('angle-2-5x1-5x1-4', 'angle', '2.5" x 1.5" x 1/4"', false, null),
  ('angle-2-5x2x1-4', 'angle', '2.5" x 2" x 1/4"', false, null),
  ('angle-2-5x2x5-16', 'angle', '2.5" x 2" x 5/16"', false, null),
  ('angle-2-5x2-5x3-16', 'angle', '2.5" x 2.5" x 3/16"', false, null),
  ('angle-2-5x2-5x1-4', 'angle', '2.5" x 2.5" x 1/4"', false, null),
  ('angle-2-5x2-5x3-8', 'angle', '2.5" x 2.5" x 3/8"', false, null),
  ('angle-2-5x2-5x1-2', 'angle', '2.5" x 2.5" x 1/2"', false, null),
  ('angle-3x2x3-16', 'angle', '3" x 2" x 3/16"', false, null),
  ('angle-3x2x1-4', 'angle', '3" x 2" x 1/4"', false, null),
  ('angle-3x2x3-8', 'angle', '3" x 2" x 3/8"', false, null),
  ('angle-3x2x1-2', 'angle', '3" x 2" x 1/2"', false, null),
  ('angle-3x3x3-16', 'angle', '3" x 3" x 3/16"', false, null),
  ('angle-3x3x1-4', 'angle', '3" x 3" x 1/4"', false, null),
  ('angle-3x3x3-8', 'angle', '3" x 3" x 3/8"', false, null),
  ('angle-3x3x1-2', 'angle', '3" x 3" x 1/2"', false, null),
  ('angle-3-5x3-5x1-4', 'angle', '3.5" x 3.5" x 1/4"', false, null),
  ('angle-3-5x3-5x3-8', 'angle', '3.5" x 3.5" x 3/8"', false, null),
  ('angle-4x3x1-4', 'angle', '4" x 3" x 1/4"', false, null),
  ('angle-4x3x3-8', 'angle', '4" x 3" x 3/8"', false, null),
  ('angle-4x3x1-2', 'angle', '4" x 3" x 1/2"', false, null),
  ('angle-4x3-5x1-2', 'angle', '4" x 3.5" x 1/2"', false, null),
  ('angle-4x4x1-4', 'angle', '4" x 4" x 1/4"', false, null),
  ('angle-4x4x3-8', 'angle', '4" x 4" x 3/8"', false, null),
  ('angle-4x4x1-2', 'angle', '4" x 4" x 1/2"', false, null),
  ('angle-4x4x5-8', 'angle', '4" x 4" x 5/8"', false, null),
  ('angle-4x4x3-4', 'angle', '4" x 4" x 3/4"', false, null),
  ('angle-5x3x1-4', 'angle', '5" x 3" x 1/4"', false, null),
  ('angle-5x3x3-8', 'angle', '5" x 3" x 3/8"', false, null),
  ('angle-5x3x1-2', 'angle', '5" x 3" x 1/2"', false, null),
  ('angle-5x3-5x1-4', 'angle', '5" x 3.5" x 1/4"', false, null),
  ('angle-5x3-5x5-16', 'angle', '5" x 3.5" x 5/16"', false, null),
  ('angle-5x3-5x3-8', 'angle', '5" x 3.5" x 3/8"', false, null),
  ('angle-5x5x3-8', 'angle', '5" x 5" x 3/8"', false, null),
  ('angle-5x5x1-2', 'angle', '5" x 5" x 1/2"', false, null),
  ('angle-6x4x3-8', 'angle', '6" x 4" x 3/8"', false, null),
  ('angle-6x4x1-2', 'angle', '6" x 4" x 1/2"', false, null),
  ('angle-6x4x3-4', 'angle', '6" x 4" x 3/4"', false, null),
  ('angle-6x6x3-8', 'angle', '6" x 6" x 3/8"', false, null),
  ('angle-6x6x1-2', 'angle', '6" x 6" x 1/2"', false, null),
  ('angle-6x6x5-8', 'angle', '6" x 6" x 5/8"', false, null),
  ('angle-6x6x3-4', 'angle', '6" x 6" x 3/4"', false, null),
  ('angle-6x6x1', 'angle', '6" x 6" x 1"', false, null),
  ('angle-8x4x1-2', 'angle', '8" x 4" x 1/2"', false, null),
  ('angle-8x4x3-4', 'angle', '8" x 4" x 3/4"', false, null),
  ('angle-8x4x1', 'angle', '8" x 4" x 1"', false, null),
  ('angle-8x6x1-2', 'angle', '8" x 6" x 1/2"', false, null),
  ('angle-8x6x3-4', 'angle', '8" x 6" x 3/4"', false, null),
  ('angle-8x6x1', 'angle', '8" x 6" x 1"', false, null),
  ('angle-8x8x1-2', 'angle', '8" x 8" x 1/2"', false, null),
  ('angle-8x8x3-4', 'angle', '8" x 8" x 3/4"', false, null),
  ('angle-8x8x1', 'angle', '8" x 8" x 1"', false, null),
  
  -- Angle dimensions (leg x leg x thickness) - Metric
  ('angle-15x15x2', 'angle', '15mm x 15mm x 2mm', true, null),
  ('angle-15x15x3', 'angle', '15mm x 15mm x 3mm', true, null),
  ('angle-20x20x2', 'angle', '20mm x 20mm x 2mm', true, null),
  ('angle-20x20x3', 'angle', '20mm x 20mm x 3mm', true, null),
  ('angle-20x20x4', 'angle', '20mm x 20mm x 4mm', true, null),
  ('angle-25x25x3', 'angle', '25mm x 25mm x 3mm', true, null),
  ('angle-25x25x4', 'angle', '25mm x 25mm x 4mm', true, null),
  ('angle-25x25x5', 'angle', '25mm x 25mm x 5mm', true, null),
  ('angle-30x30x3', 'angle', '30mm x 30mm x 3mm', true, null),
  ('angle-30x30x4', 'angle', '30mm x 30mm x 4mm', true, null),
  ('angle-30x30x5', 'angle', '30mm x 30mm x 5mm', true, null),
  ('angle-35x35x4', 'angle', '35mm x 35mm x 4mm', true, null),
  ('angle-35x35x5', 'angle', '35mm x 35mm x 5mm', true, null),
  ('angle-40x40x4', 'angle', '40mm x 40mm x 4mm', true, null),
  ('angle-40x40x5', 'angle', '40mm x 40mm x 5mm', true, null),
  ('angle-40x40x6', 'angle', '40mm x 40mm x 6mm', true, null),
  ('angle-45x45x4', 'angle', '45mm x 45mm x 4mm', true, null),
  ('angle-45x45x5', 'angle', '45mm x 45mm x 5mm', true, null),
  ('angle-45x45x6', 'angle', '45mm x 45mm x 6mm', true, null),
  ('angle-50x50x5', 'angle', '50mm x 50mm x 5mm', true, null),
  ('angle-50x50x6', 'angle', '50mm x 50mm x 6mm', true, null),
  ('angle-50x50x8', 'angle', '50mm x 50mm x 8mm', true, null),
  ('angle-60x60x5', 'angle', '60mm x 60mm x 5mm', true, null),
  ('angle-60x60x6', 'angle', '60mm x 60mm x 6mm', true, null),
  ('angle-60x60x8', 'angle', '60mm x 60mm x 8mm', true, null),
  ('angle-70x70x6', 'angle', '70mm x 70mm x 6mm', true, null),
  ('angle-70x70x8', 'angle', '70mm x 70mm x 8mm', true, null),
  ('angle-80x80x6', 'angle', '80mm x 80mm x 6mm', true, null),
  ('angle-80x80x8', 'angle', '80mm x 80mm x 8mm', true, null),
  ('angle-80x80x10', 'angle', '80mm x 80mm x 10mm', true, null),
  ('angle-100x100x8', 'angle', '100mm x 100mm x 8mm', true, null),
  ('angle-100x100x10', 'angle', '100mm x 100mm x 10mm', true, null),
  ('angle-100x100x12', 'angle', '100mm x 100mm x 12mm', true, null),
  ('angle-120x120x10', 'angle', '120mm x 120mm x 10mm', true, null),
  ('angle-120x120x12', 'angle', '120mm x 120mm x 12mm', true, null),
  ('angle-120x120x15', 'angle', '120mm x 120mm x 15mm', true, null),
  ('angle-150x150x12', 'angle', '150mm x 150mm x 12mm', true, null),
  ('angle-150x150x15', 'angle', '150mm x 150mm x 15mm', true, null),
  ('angle-200x200x15', 'angle', '200mm x 200mm x 15mm', true, null),
  ('angle-200x200x20', 'angle', '200mm x 200mm x 20mm', true, null),
  
  -- Unequal angles (metric)
  ('angle-30x20x3', 'angle', '30mm x 20mm x 3mm', true, null),
  ('angle-40x25x4', 'angle', '40mm x 25mm x 4mm', true, null),
  ('angle-40x30x4', 'angle', '40mm x 30mm x 4mm', true, null),
  ('angle-50x30x5', 'angle', '50mm x 30mm x 5mm', true, null),
  ('angle-60x40x5', 'angle', '60mm x 40mm x 5mm', true, null),
  ('angle-60x40x6', 'angle', '60mm x 40mm x 6mm', true, null),
  ('angle-80x60x6', 'angle', '80mm x 60mm x 6mm', true, null),
  ('angle-80x60x8', 'angle', '80mm x 60mm x 8mm', true, null),
  ('angle-100x65x8', 'angle', '100mm x 65mm x 8mm', true, null),
  ('angle-100x65x10', 'angle', '100mm x 65mm x 10mm', true, null),
  ('angle-120x80x10', 'angle', '120mm x 80mm x 10mm', true, null),
  ('angle-120x80x12', 'angle', '120mm x 80mm x 12mm', true, null),
  ('angle-150x90x12', 'angle', '150mm x 90mm x 12mm', true, null),
  ('angle-150x90x15', 'angle', '150mm x 90mm x 15mm', true, null),
  ('angle-200x100x15', 'angle', '200mm x 100mm x 15mm', true, null),
  ('angle-200x100x20', 'angle', '200mm x 100mm x 20mm', true, null),
  
  -- Channel dimensions (depth x flange width x thickness) - Imperial
  ('channel-3x1-41x170', 'channel', 'C3 x 4.1', false, null),
  ('channel-4x5-4x184', 'channel', 'C4 x 5.4', false, null),
  ('channel-5x6-7x190', 'channel', 'C5 x 6.7', false, null),
  ('channel-6x8-2x200', 'channel', 'C6 x 8.2', false, null),
  ('channel-7x9-8x210', 'channel', 'C7 x 9.8', false, null),
  ('channel-8x11-5x220', 'channel', 'C8 x 11.5', false, null),
  ('channel-9x13-4x233', 'channel', 'C9 x 13.4', false, null),
  ('channel-10x15-3x240', 'channel', 'C10 x 15.3', false, null),
  ('channel-12x20-7x282', 'channel', 'C12 x 20.7', false, null),
  
  -- Channel dimensions (metric)
  ('channel-u80x45x7', 'channel', 'U80 x 45 x 7', true, null),
  ('channel-u100x50x6', 'channel', 'U100 x 50 x 6', true, null),
  ('channel-u120x55x8', 'channel', 'U120 x 55 x 8', true, null),
  ('channel-u140x60x9', 'channel', 'U140 x 60 x 9', true, null),
  ('channel-u160x65x10', 'channel', 'U160 x 65 x 10', true, null),
  ('channel-u180x70x11', 'channel', 'U180 x 70 x 11', true, null),
  ('channel-u200x75x11', 'channel', 'U200 x 75 x 11', true, null),
  ('channel-u220x80x12', 'channel', 'U220 x 80 x 12', true, null),
  ('channel-u240x85x13', 'channel', 'U240 x 85 x 13', true, null),
  ('channel-u260x90x14', 'channel', 'U260 x 90 x 14', true, null),
  ('channel-u280x95x15', 'channel', 'U280 x 95 x 15', true, null),
  ('channel-u300x100x16', 'channel', 'U300 x 100 x 16', true, null),
  
  -- Filament dimensions (diameters for 3D printing) - already in metric, but mark appropriately
  ('filament-1-75', 'filament', '1.75mm', true, null),
  ('filament-3', 'filament', '3.0mm', true, null),
  
  -- Pellet dimensions (mesh sizes) - these are universal standards, not metric/imperial specific
  ('pellet-4', 'pellet', '4 mesh', false, null),
  ('pellet-6', 'pellet', '6 mesh', false, null),
  ('pellet-8', 'pellet', '8 mesh', false, null),
  ('pellet-10', 'pellet', '10 mesh', false, null),
  ('pellet-12', 'pellet', '12 mesh', false, null),
  ('pellet-14', 'pellet', '14 mesh', false, null),
  ('pellet-16', 'pellet', '16 mesh', false, null),
  ('pellet-20', 'pellet', '20 mesh', false, null),
  
  -- Billet dimensions (width x height) - Imperial
  ('billet-1x1', 'billet', '1" x 1"', false, null),
  ('billet-1-5x1-5', 'billet', '1.5" x 1.5"', false, null),
  ('billet-2x2', 'billet', '2" x 2"', false, null),
  ('billet-2x3', 'billet', '2" x 3"', false, null),
  ('billet-2x4', 'billet', '2" x 4"', false, null),
  ('billet-3x3', 'billet', '3" x 3"', false, null),
  ('billet-3x4', 'billet', '3" x 4"', false, null),
  ('billet-3x6', 'billet', '3" x 6"', false, null),
  ('billet-4x4', 'billet', '4" x 4"', false, null),
  ('billet-4x6', 'billet', '4" x 6"', false, null),
  ('billet-6x6', 'billet', '6" x 6"', false, null),
  ('billet-6x8', 'billet', '6" x 8"', false, null),
  ('billet-8x8', 'billet', '8" x 8"', false, null),
  ('billet-8x10', 'billet', '8" x 10"', false, null),
  ('billet-10x10', 'billet', '10" x 10"', false, null),
  
  -- Round billet dimensions (diameter) - Imperial
  ('billet-round-1', 'billet', '1" ⌀', false, null),
  ('billet-round-1-5', 'billet', '1.5" ⌀', false, null),
  ('billet-round-2', 'billet', '2" ⌀', false, null),
  ('billet-round-3', 'billet', '3" ⌀', false, null),
  ('billet-round-4', 'billet', '4" ⌀', false, null),
  ('billet-round-5', 'billet', '5" ⌀', false, null),
  ('billet-round-6', 'billet', '6" ⌀', false, null),
  ('billet-round-8', 'billet', '8" ⌀', false, null),
  ('billet-round-10', 'billet', '10" ⌀', false, null),
  ('billet-round-12', 'billet', '12" ⌀', false, null),
  
  -- Billet dimensions (width x height) - Metric
  ('billet-25x25', 'billet', '25mm x 25mm', true, null),
  ('billet-30x30', 'billet', '30mm x 30mm', true, null),
  ('billet-40x40', 'billet', '40mm x 40mm', true, null),
  ('billet-50x50', 'billet', '50mm x 50mm', true, null),
  ('billet-50x75', 'billet', '50mm x 75mm', true, null),
  ('billet-50x100', 'billet', '50mm x 100mm', true, null),
  ('billet-75x75', 'billet', '75mm x 75mm', true, null),
  ('billet-75x100', 'billet', '75mm x 100mm', true, null),
  ('billet-75x150', 'billet', '75mm x 150mm', true, null),
  ('billet-100x100', 'billet', '100mm x 100mm', true, null),
  ('billet-100x150', 'billet', '100mm x 150mm', true, null),
  ('billet-100x200', 'billet', '100mm x 200mm', true, null),
  ('billet-150x150', 'billet', '150mm x 150mm', true, null),
  ('billet-150x200', 'billet', '150mm x 200mm', true, null),
  ('billet-200x200', 'billet', '200mm x 200mm', true, null),
  ('billet-200x250', 'billet', '200mm x 250mm', true, null),
  ('billet-250x250', 'billet', '250mm x 250mm', true, null),
  
  -- Round billet dimensions (diameter) - Metric
  ('billet-round-25', 'billet', '25mm ⌀', true, null),
  ('billet-round-30', 'billet', '30mm ⌀', true, null),
  ('billet-round-40', 'billet', '40mm ⌀', true, null),
  ('billet-round-50', 'billet', '50mm ⌀', true, null),
  ('billet-round-60', 'billet', '60mm ⌀', true, null),
  ('billet-round-75', 'billet', '75mm ⌀', true, null),
  ('billet-round-80', 'billet', '80mm ⌀', true, null),
  ('billet-round-100', 'billet', '100mm ⌀', true, null),
  ('billet-round-120', 'billet', '120mm ⌀', true, null),
  ('billet-round-150', 'billet', '150mm ⌀', true, null),
  ('billet-round-200', 'billet', '200mm ⌀', true, null),
  ('billet-round-250', 'billet', '250mm ⌀', true, null),
  ('billet-round-300', 'billet', '300mm ⌀', true, null);


-- Enable Row Level Security on new tables
ALTER TABLE "materialFinish" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "materialGrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "materialType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "materialDimension" ENABLE ROW LEVEL SECURITY;

-- RLS Policies for materialFinish table
CREATE POLICY "SELECT" ON "materialFinish"
FOR SELECT 
USING (
  "companyId" IS NULL 
  OR "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "materialFinish"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "materialFinish"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "materialFinish"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_delete')
    )::text[]
  )
);

-- RLS Policies for materialGrade table
CREATE POLICY "SELECT" ON "materialGrade"
FOR SELECT 
USING (
  "companyId" IS NULL 
  OR "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "materialGrade"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "materialGrade"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "materialGrade"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_delete')
    )::text[]
  )
);

-- RLS Policies for materialType table
CREATE POLICY "SELECT" ON "materialType"
FOR SELECT 
USING (
  "companyId" IS NULL 
  OR "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "materialType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "materialType"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "materialType"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_delete')
    )::text[]
  )
);

-- RLS Policies for materialDimension table
CREATE POLICY "SELECT" ON "materialDimension"
FOR SELECT 
USING (
  "companyId" IS NULL 
  OR "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "materialDimension"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "materialDimension"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "materialDimension"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_delete')
    )::text[]
  )
);