ALTER TABLE "companySettings" ADD COLUMN "materialGeneratedIds" BOOLEAN NOT NULL DEFAULT FALSE;

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



CREATE TABLE "materialDimension" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "materialFormId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
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
    "materialDimension"."companyId",
    "materialForm"."name" AS "formName"
  FROM "materialDimension"
  LEFT JOIN "materialForm" ON "materialDimension"."materialFormId" = "materialForm"."id";

INSERT INTO "materialDimension" ("id", "materialFormId", "name", "companyId") VALUES
  -- Sheet dimensions (gauges)
  ('sheet-20ga', 'sheet', '20 Gauge', null),
  ('sheet-18ga', 'sheet', '18 Gauge', null),
  ('sheet-16ga', 'sheet', '16 Gauge', null),
  ('sheet-14ga', 'sheet', '14 Gauge', null),
  ('sheet-12ga', 'sheet', '12 Gauge', null),
  ('sheet-11ga', 'sheet', '11 Gauge', null),
  ('sheet-10ga', 'sheet', '10 Gauge', null),
  ('sheet-7ga', 'sheet', '7 Gauge', null),
  
  -- Plate dimensions (thicknesses)
  ('plate-1-8', 'plate', '1/8"', null),
  ('plate-3-16', 'plate', '3/16"', null),
  ('plate-1-4', 'plate', '1/4"', null),
  ('plate-5-16', 'plate', '5/16"', null),
  ('plate-3-8', 'plate', '3/8"', null),
  ('plate-1-2', 'plate', '1/2"', null),
  ('plate-5-8', 'plate', '5/8"', null),
  ('plate-3-4', 'plate', '3/4"', null),
  ('plate-1', 'plate', '1"', null),
  ('plate-1-25', 'plate', '1.25"', null),
  ('plate-1-5', 'plate', '1.5"', null),
  ('plate-2', 'plate', '2"', null),
  
  -- Round bar dimensions (diameters)
  ('roundbar-1-8', 'roundbar', '1/8"', null),
  ('roundbar-3-16', 'roundbar', '3/16"', null),
  ('roundbar-1-4', 'roundbar', '1/4"', null),
  ('roundbar-5-16', 'roundbar', '5/16"', null),
  ('roundbar-3-8', 'roundbar', '3/8"', null),
  ('roundbar-1-2', 'roundbar', '1/2"', null),
  ('roundbar-5-8', 'roundbar', '5/8"', null),
  ('roundbar-3-4', 'roundbar', '3/4"', null),
  ('roundbar-7-8', 'roundbar', '7/8"', null),
  ('roundbar-1', 'roundbar', '1"', null),
  ('roundbar-1-25', 'roundbar', '1.25"', null),
  ('roundbar-1-5', 'roundbar', '1.5"', null),
  ('roundbar-2', 'roundbar', '2"', null),
  ('roundbar-2-5', 'roundbar', '2.5"', null),
  ('roundbar-3', 'roundbar', '3"', null),
  ('roundbar-4', 'roundbar', '4"', null),
  
  -- Square bar dimensions
  ('squarebar-1-8', 'squarebar', '1/8"', null),
  ('squarebar-3-16', 'squarebar', '3/16"', null),
  ('squarebar-1-4', 'squarebar', '1/4"', null),
  ('squarebar-5-16', 'squarebar', '5/16"', null),
  ('squarebar-3-8', 'squarebar', '3/8"', null),
  ('squarebar-1-2', 'squarebar', '1/2"', null),
  ('squarebar-5-8', 'squarebar', '5/8"', null),
  ('squarebar-3-4', 'squarebar', '3/4"', null),
  ('squarebar-1', 'squarebar', '1"', null),
  ('squarebar-1-25', 'squarebar', '1.25"', null),
  ('squarebar-1-5', 'squarebar', '1.5"', null),
  ('squarebar-2', 'squarebar', '2"', null),
  
  -- Hex bar dimensions
  ('hexbar-1-4', 'hexbar', '1/4"', null),
  ('hexbar-5-16', 'hexbar', '5/16"', null),
  ('hexbar-3-8', 'hexbar', '3/8"', null),
  ('hexbar-1-2', 'hexbar', '1/2"', null),
  ('hexbar-5-8', 'hexbar', '5/8"', null),
  ('hexbar-3-4', 'hexbar', '3/4"', null),
  ('hexbar-7-8', 'hexbar', '7/8"', null),
  ('hexbar-1', 'hexbar', '1"', null),
  ('hexbar-1-25', 'hexbar', '1.25"', null),
  ('hexbar-1-5', 'hexbar', '1.5"', null),
  
  -- Flat bar dimensions (thickness x width)
  ('flatbar-1-8x1-2', 'flatbar', '1/8" x 1/2"', null),
  ('flatbar-1-8x3-4', 'flatbar', '1/8" x 3/4"', null),
  ('flatbar-1-8x1', 'flatbar', '1/8" x 1"', null),
  ('flatbar-3-16x1-2', 'flatbar', '3/16" x 1/2"', null),
  ('flatbar-3-16x3-4', 'flatbar', '3/16" x 3/4"', null),
  ('flatbar-3-16x1', 'flatbar', '3/16" x 1"', null),
  ('flatbar-1-4x1-2', 'flatbar', '1/4" x 1/2"', null),
  ('flatbar-1-4x3-4', 'flatbar', '1/4" x 3/4"', null),
  ('flatbar-1-4x1', 'flatbar', '1/4" x 1"', null),
  ('flatbar-1-4x1-5', 'flatbar', '1/4" x 1.5"', null),
  ('flatbar-1-4x2', 'flatbar', '1/4" x 2"', null),
  ('flatbar-3-8x1', 'flatbar', '3/8" x 1"', null),
  ('flatbar-3-8x1-5', 'flatbar', '3/8" x 1.5"', null),
  ('flatbar-3-8x2', 'flatbar', '3/8" x 2"', null),
  ('flatbar-1-2x1', 'flatbar', '1/2" x 1"', null),
  ('flatbar-1-2x1-5', 'flatbar', '1/2" x 1.5"', null),
  ('flatbar-1-2x2', 'flatbar', '1/2" x 2"', null),
  ('flatbar-1-2x3', 'flatbar', '1/2" x 3"', null),
  
  -- Round tube dimensions (OD x wall thickness)
  ('roundtube-1-2x049', 'roundtube', '1/2" x .049"', null),
  ('roundtube-5-8x049', 'roundtube', '5/8" x .049"', null),
  ('roundtube-3-4x049', 'roundtube', '3/4" x .049"', null),
  ('roundtube-7-8x049', 'roundtube', '7/8" x .049"', null),
  ('roundtube-1x049', 'roundtube', '1" x .049"', null),
  ('roundtube-1x065', 'roundtube', '1" x .065"', null),
  ('roundtube-1-25x049', 'roundtube', '1.25" x .049"', null),
  ('roundtube-1-25x065', 'roundtube', '1.25" x .065"', null),
  ('roundtube-1-5x049', 'roundtube', '1.5" x .049"', null),
  ('roundtube-1-5x065', 'roundtube', '1.5" x .065"', null),
  ('roundtube-2x049', 'roundtube', '2" x .049"', null),
  ('roundtube-2x065', 'roundtube', '2" x .065"', null),
  ('roundtube-2x083', 'roundtube', '2" x .083"', null),
  
  -- Square tube dimensions (size x wall thickness)
  ('squaretube-1-2x049', 'squaretube', '1/2" x .049"', null),
  ('squaretube-5-8x049', 'squaretube', '5/8" x .049"', null),
  ('squaretube-3-4x049', 'squaretube', '3/4" x .049"', null),
  ('squaretube-1x049', 'squaretube', '1" x .049"', null),
  ('squaretube-1x065', 'squaretube', '1" x .065"', null),
  ('squaretube-1-25x049', 'squaretube', '1.25" x .049"', null),
  ('squaretube-1-25x065', 'squaretube', '1.25" x .065"', null),
  ('squaretube-1-5x049', 'squaretube', '1.5" x .049"', null),
  ('squaretube-1-5x065', 'squaretube', '1.5" x .065"', null),
  ('squaretube-2x049', 'squaretube', '2" x .049"', null),
  ('squaretube-2x065', 'squaretube', '2" x .065"', null),
  ('squaretube-2x083', 'squaretube', '2" x .083"', null),
  
  -- Rectangular tube dimensions (width x height x wall thickness)
  ('recttube-1x2x049', 'recttube', '1" x 2" x .049"', null),
  ('recttube-1x2x065', 'recttube', '1" x 2" x .065"', null),
  ('recttube-1-5x2x049', 'recttube', '1.5" x 2" x .049"', null),
  ('recttube-1-5x2x065', 'recttube', '1.5" x 2" x .065"', null),
  ('recttube-2x3x049', 'recttube', '2" x 3" x .049"', null),
  ('recttube-2x3x065', 'recttube', '2" x 3" x .065"', null),
  ('recttube-2x4x049', 'recttube', '2" x 4" x .049"', null),
  ('recttube-2x4x065', 'recttube', '2" x 4" x .065"', null),
  ('recttube-3x4x065', 'recttube', '3" x 4" x .065"', null),
  
  -- Rectangular bar dimensions (thickness x width)
  ('rectbar-1-8x1-2', 'rectbar', '1/8" x 1/2"', null),
  ('rectbar-1-4x1-2', 'rectbar', '1/4" x 1/2"', null),
  ('rectbar-1-4x3-4', 'rectbar', '1/4" x 3/4"', null),
  ('rectbar-1-4x1', 'rectbar', '1/4" x 1"', null),
  ('rectbar-3-8x3-4', 'rectbar', '3/8" x 3/4"', null),
  ('rectbar-3-8x1', 'rectbar', '3/8" x 1"', null),
  ('rectbar-1-2x1', 'rectbar', '1/2" x 1"', null),
  ('rectbar-1-2x1-5', 'rectbar', '1/2" x 1.5"', null),
  ('rectbar-1-2x2', 'rectbar', '1/2" x 2"', null),
  
  -- Angle dimensions (leg x leg x thickness)
  ('angle-1-2x1-2x1-8', 'angle', '1/2" x 1/2" x 1/8"', null),
  ('angle-5-8x5-8x1-8', 'angle', '5/8" x 5/8" x 1/8"', null),
  ('angle-3-4x3-4x1-8', 'angle', '3/4" x 3/4" x 1/8"', null),
  ('angle-1x1x1-8', 'angle', '1" x 1" x 1/8"', null),
  ('angle-1x1x3-16', 'angle', '1" x 1" x 3/16"', null),
  ('angle-1x1x1-4', 'angle', '1" x 1" x 1/4"', null),
  ('angle-1-25x1-25x1-8', 'angle', '1.25" x 1.25" x 1/8"', null),
  ('angle-1-25x1-25x3-16', 'angle', '1.25" x 1.25" x 3/16"', null),
  ('angle-1-25x1-25x1-4', 'angle', '1.25" x 1.25" x 1/4"', null),
  ('angle-1-5x1-5x1-8', 'angle', '1.5" x 1.5" x 1/8"', null),
  ('angle-1-5x1-5x3-16', 'angle', '1.5" x 1.5" x 3/16"', null),
  ('angle-1-5x1-5x1-4', 'angle', '1.5" x 1.5" x 1/4"', null),
  ('angle-1-75x1-75x1-8', 'angle', '1.75" x 1.75" x 1/8"', null),
  ('angle-1-75x1-75x3-16', 'angle', '1.75" x 1.75" x 3/16"', null),
  ('angle-1-75x1-75x1-4', 'angle', '1.75" x 1.75" x 1/4"', null),
  ('angle-2x1-5x1-8', 'angle', '2" x 1.5" x 1/8"', null),
  ('angle-2x1-5x3-16', 'angle', '2" x 1.5" x 3/16"', null),
  ('angle-2x1-5x1-4', 'angle', '2" x 1.5" x 1/4"', null),
  ('angle-2x2x1-8', 'angle', '2" x 2" x 1/8"', null),
  ('angle-2x2x3-16', 'angle', '2" x 2" x 3/16"', null),
  ('angle-2x2x1-4', 'angle', '2" x 2" x 1/4"', null),
  ('angle-2x2x3-8', 'angle', '2" x 2" x 3/8"', null),
  ('angle-2-5x1-5x3-16', 'angle', '2.5" x 1.5" x 3/16"', null),
  ('angle-2-5x1-5x1-4', 'angle', '2.5" x 1.5" x 1/4"', null),
  ('angle-2-5x2x1-4', 'angle', '2.5" x 2" x 1/4"', null),
  ('angle-2-5x2x5-16', 'angle', '2.5" x 2" x 5/16"', null),
  ('angle-2-5x2-5x3-16', 'angle', '2.5" x 2.5" x 3/16"', null),
  ('angle-2-5x2-5x1-4', 'angle', '2.5" x 2.5" x 1/4"', null),
  ('angle-2-5x2-5x3-8', 'angle', '2.5" x 2.5" x 3/8"', null),
  ('angle-2-5x2-5x1-2', 'angle', '2.5" x 2.5" x 1/2"', null),
  ('angle-3x2x3-16', 'angle', '3" x 2" x 3/16"', null),
  ('angle-3x2x1-4', 'angle', '3" x 2" x 1/4"', null),
  ('angle-3x2x3-8', 'angle', '3" x 2" x 3/8"', null),
  ('angle-3x2x1-2', 'angle', '3" x 2" x 1/2"', null),
  ('angle-3x3x3-16', 'angle', '3" x 3" x 3/16"', null),
  ('angle-3x3x1-4', 'angle', '3" x 3" x 1/4"', null),
  ('angle-3x3x3-8', 'angle', '3" x 3" x 3/8"', null),
  ('angle-3x3x1-2', 'angle', '3" x 3" x 1/2"', null),
  ('angle-3-5x3-5x1-4', 'angle', '3.5" x 3.5" x 1/4"', null),
  ('angle-3-5x3-5x3-8', 'angle', '3.5" x 3.5" x 3/8"', null),
  ('angle-4x3x1-4', 'angle', '4" x 3" x 1/4"', null),
  ('angle-4x3x3-8', 'angle', '4" x 3" x 3/8"', null),
  ('angle-4x3x1-2', 'angle', '4" x 3" x 1/2"', null),
  ('angle-4x3-5x1-2', 'angle', '4" x 3.5" x 1/2"', null),
  ('angle-4x4x1-4', 'angle', '4" x 4" x 1/4"', null),
  ('angle-4x4x3-8', 'angle', '4" x 4" x 3/8"', null),
  ('angle-4x4x1-2', 'angle', '4" x 4" x 1/2"', null),
  ('angle-4x4x5-8', 'angle', '4" x 4" x 5/8"', null),
  ('angle-4x4x3-4', 'angle', '4" x 4" x 3/4"', null),
  ('angle-5x3x1-4', 'angle', '5" x 3" x 1/4"', null),
  ('angle-5x3x3-8', 'angle', '5" x 3" x 3/8"', null),
  ('angle-5x3x1-2', 'angle', '5" x 3" x 1/2"', null),
  ('angle-5x3-5x1-4', 'angle', '5" x 3.5" x 1/4"', null),
  ('angle-5x3-5x5-16', 'angle', '5" x 3.5" x 5/16"', null),
  ('angle-5x3-5x3-8', 'angle', '5" x 3.5" x 3/8"', null),
  ('angle-5x5x3-8', 'angle', '5" x 5" x 3/8"', null),
  ('angle-5x5x1-2', 'angle', '5" x 5" x 1/2"', null),
  ('angle-6x4x3-8', 'angle', '6" x 4" x 3/8"', null),
  ('angle-6x4x1-2', 'angle', '6" x 4" x 1/2"', null),
  ('angle-6x4x3-4', 'angle', '6" x 4" x 3/4"', null),
  ('angle-6x6x3-8', 'angle', '6" x 6" x 3/8"', null),
  ('angle-6x6x1-2', 'angle', '6" x 6" x 1/2"', null),
  ('angle-6x6x5-8', 'angle', '6" x 6" x 5/8"', null),
  ('angle-6x6x3-4', 'angle', '6" x 6" x 3/4"', null),
  ('angle-6x6x1', 'angle', '6" x 6" x 1"', null),
  ('angle-8x4x1-2', 'angle', '8" x 4" x 1/2"', null),
  ('angle-8x4x3-4', 'angle', '8" x 4" x 3/4"', null),
  ('angle-8x4x1', 'angle', '8" x 4" x 1"', null),
  ('angle-8x6x1-2', 'angle', '8" x 6" x 1/2"', null),
  ('angle-8x6x3-4', 'angle', '8" x 6" x 3/4"', null),
  ('angle-8x6x1', 'angle', '8" x 6" x 1"', null),
  ('angle-8x8x1-2', 'angle', '8" x 8" x 1/2"', null),
  ('angle-8x8x3-4', 'angle', '8" x 8" x 3/4"', null),
  ('angle-8x8x1', 'angle', '8" x 8" x 1"', null),
  
  -- Channel dimensions (depth x flange width x thickness)
  ('channel-3x1-41x170', 'channel', 'C3 x 4.1', null),
  ('channel-4x5-4x184', 'channel', 'C4 x 5.4', null),
  ('channel-5x6-7x190', 'channel', 'C5 x 6.7', null),
  ('channel-6x8-2x200', 'channel', 'C6 x 8.2', null),
  ('channel-7x9-8x210', 'channel', 'C7 x 9.8', null),
  ('channel-8x11-5x220', 'channel', 'C8 x 11.5', null),
  ('channel-9x13-4x233', 'channel', 'C9 x 13.4', null),
  ('channel-10x15-3x240', 'channel', 'C10 x 15.3', null),
  ('channel-12x20-7x282', 'channel', 'C12 x 20.7', null),
  
  -- Filament dimensions (diameters for 3D printing)
  ('filament-1-75', 'filament', '1.75mm', null),
  ('filament-3', 'filament', '3.0mm', null),
  
  -- Pellet dimensions (mesh sizes)
  ('pellet-4', 'pellet', '4 mesh', null),
  ('pellet-6', 'pellet', '6 mesh', null),
  ('pellet-8', 'pellet', '8 mesh', null),
  ('pellet-10', 'pellet', '10 mesh', null),
  ('pellet-12', 'pellet', '12 mesh', null),
  ('pellet-14', 'pellet', '14 mesh', null),
  ('pellet-16', 'pellet', '16 mesh', null),
  ('pellet-20', 'pellet', '20 mesh', null);




