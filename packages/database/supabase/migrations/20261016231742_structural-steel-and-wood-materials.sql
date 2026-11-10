-- Structural steel and wood for fabricators (trailers, frames, weldments).
-- Adds what the seed leaves out: W- and S-beam sizes, structural (HSS) tube walls,
-- structural steel grades, and wood as a substance with a lumber shape. Names follow
-- the seeded style ('C3 x 4.1', '1" x 2" x .049"') so generated material ids stay
-- consistent. All rows are system-wide (companyId NULL).

-- Structural steel grades
INSERT INTO "materialGrade" ("id", "materialSubstanceId", "name", "companyId") VALUES
  ('steel-a992', 'steel', 'A992', null),
  ('steel-a500-gr-b', 'steel', 'A500 Gr B', null),
  ('steel-a500-gr-c', 'steel', 'A500 Gr C', null),
  ('steel-a572-gr-50', 'steel', 'A572 Gr 50', null),
  ('steel-a1011-cs', 'steel', 'A1011 CS', null),
  ('steel-a1011-ss-gr-50', 'steel', 'A1011 SS Gr 50', null),
  ('steel-a513', 'steel', 'A513', null);

INSERT INTO "materialDimension" ("id", "materialFormId", "name", "isMetric", "companyId") VALUES
  -- W-beams (wide flange): depth x weight per foot
  ('wbeam-w4-x-13', 'wbeam', 'W4 x 13', false, null),
  ('wbeam-w5-x-16', 'wbeam', 'W5 x 16', false, null),
  ('wbeam-w5-x-19', 'wbeam', 'W5 x 19', false, null),
  ('wbeam-w6-x-9', 'wbeam', 'W6 x 9', false, null),
  ('wbeam-w6-x-12', 'wbeam', 'W6 x 12', false, null),
  ('wbeam-w6-x-15', 'wbeam', 'W6 x 15', false, null),
  ('wbeam-w6-x-16', 'wbeam', 'W6 x 16', false, null),
  ('wbeam-w6-x-20', 'wbeam', 'W6 x 20', false, null),
  ('wbeam-w6-x-25', 'wbeam', 'W6 x 25', false, null),
  ('wbeam-w8-x-10', 'wbeam', 'W8 x 10', false, null),
  ('wbeam-w8-x-13', 'wbeam', 'W8 x 13', false, null),
  ('wbeam-w8-x-15', 'wbeam', 'W8 x 15', false, null),
  ('wbeam-w8-x-18', 'wbeam', 'W8 x 18', false, null),
  ('wbeam-w8-x-21', 'wbeam', 'W8 x 21', false, null),
  ('wbeam-w8-x-24', 'wbeam', 'W8 x 24', false, null),
  ('wbeam-w8-x-28', 'wbeam', 'W8 x 28', false, null),
  ('wbeam-w8-x-31', 'wbeam', 'W8 x 31', false, null),
  ('wbeam-w8-x-35', 'wbeam', 'W8 x 35', false, null),
  ('wbeam-w8-x-40', 'wbeam', 'W8 x 40', false, null),
  ('wbeam-w10-x-12', 'wbeam', 'W10 x 12', false, null),
  ('wbeam-w10-x-15', 'wbeam', 'W10 x 15', false, null),
  ('wbeam-w10-x-17', 'wbeam', 'W10 x 17', false, null),
  ('wbeam-w10-x-19', 'wbeam', 'W10 x 19', false, null),
  ('wbeam-w10-x-22', 'wbeam', 'W10 x 22', false, null),
  ('wbeam-w10-x-26', 'wbeam', 'W10 x 26', false, null),
  ('wbeam-w10-x-30', 'wbeam', 'W10 x 30', false, null),
  ('wbeam-w10-x-33', 'wbeam', 'W10 x 33', false, null),
  ('wbeam-w12-x-14', 'wbeam', 'W12 x 14', false, null),
  ('wbeam-w12-x-16', 'wbeam', 'W12 x 16', false, null),
  ('wbeam-w12-x-19', 'wbeam', 'W12 x 19', false, null),
  ('wbeam-w12-x-22', 'wbeam', 'W12 x 22', false, null),
  ('wbeam-w12-x-26', 'wbeam', 'W12 x 26', false, null),
  ('wbeam-w12-x-30', 'wbeam', 'W12 x 30', false, null),
  ('wbeam-w12-x-35', 'wbeam', 'W12 x 35', false, null),
  ('wbeam-w12-x-40', 'wbeam', 'W12 x 40', false, null),
  ('wbeam-w14-x-22', 'wbeam', 'W14 x 22', false, null),
  ('wbeam-w14-x-26', 'wbeam', 'W14 x 26', false, null),
  ('wbeam-w14-x-30', 'wbeam', 'W14 x 30', false, null),
  ('wbeam-w14-x-34', 'wbeam', 'W14 x 34', false, null),
  ('wbeam-w16-x-26', 'wbeam', 'W16 x 26', false, null),
  ('wbeam-w16-x-31', 'wbeam', 'W16 x 31', false, null),
  -- S-beams (American standard)
  ('sbeam-s3-x-5-7', 'sbeam', 'S3 x 5.7', false, null),
  ('sbeam-s3-x-7-5', 'sbeam', 'S3 x 7.5', false, null),
  ('sbeam-s4-x-7-7', 'sbeam', 'S4 x 7.7', false, null),
  ('sbeam-s4-x-9-5', 'sbeam', 'S4 x 9.5', false, null),
  ('sbeam-s5-x-10', 'sbeam', 'S5 x 10', false, null),
  ('sbeam-s6-x-12-5', 'sbeam', 'S6 x 12.5', false, null),
  ('sbeam-s6-x-17-25', 'sbeam', 'S6 x 17.25', false, null),
  ('sbeam-s8-x-18-4', 'sbeam', 'S8 x 18.4', false, null),
  ('sbeam-s8-x-23', 'sbeam', 'S8 x 23', false, null),
  ('sbeam-s10-x-25-4', 'sbeam', 'S10 x 25.4', false, null),
  ('sbeam-s10-x-35', 'sbeam', 'S10 x 35', false, null),
  ('sbeam-s12-x-31-8', 'sbeam', 'S12 x 31.8', false, null),
  ('sbeam-s12-x-35', 'sbeam', 'S12 x 35', false, null),
  -- Structural rectangular tube (HSS): nominal 1/8, 3/16, 1/4 walls
  ('recttube-1x2x-125', 'recttube', '1" x 2" x .125"', false, null),
  ('recttube-1x3x-125', 'recttube', '1" x 3" x .125"', false, null),
  ('recttube-1-5x2x-125', 'recttube', '1.5" x 2" x .125"', false, null),
  ('recttube-1-5x2x-188', 'recttube', '1.5" x 2" x .188"', false, null),
  ('recttube-1-5x2-5x-125', 'recttube', '1.5" x 2.5" x .125"', false, null),
  ('recttube-1-5x2-5x-188', 'recttube', '1.5" x 2.5" x .188"', false, null),
  ('recttube-1-5x3x-125', 'recttube', '1.5" x 3" x .125"', false, null),
  ('recttube-1-5x3x-188', 'recttube', '1.5" x 3" x .188"', false, null),
  ('recttube-2x3x-125', 'recttube', '2" x 3" x .125"', false, null),
  ('recttube-2x3x-188', 'recttube', '2" x 3" x .188"', false, null),
  ('recttube-2x3x-250', 'recttube', '2" x 3" x .250"', false, null),
  ('recttube-2x4x-125', 'recttube', '2" x 4" x .125"', false, null),
  ('recttube-2x4x-188', 'recttube', '2" x 4" x .188"', false, null),
  ('recttube-2x4x-250', 'recttube', '2" x 4" x .250"', false, null),
  ('recttube-2x5x-188', 'recttube', '2" x 5" x .188"', false, null),
  ('recttube-2x5x-250', 'recttube', '2" x 5" x .250"', false, null),
  ('recttube-2x6x-188', 'recttube', '2" x 6" x .188"', false, null),
  ('recttube-2x6x-250', 'recttube', '2" x 6" x .250"', false, null),
  ('recttube-3x4x-125', 'recttube', '3" x 4" x .125"', false, null),
  ('recttube-3x4x-188', 'recttube', '3" x 4" x .188"', false, null),
  ('recttube-3x4x-250', 'recttube', '3" x 4" x .250"', false, null),
  ('recttube-3x5x-188', 'recttube', '3" x 5" x .188"', false, null),
  ('recttube-3x5x-250', 'recttube', '3" x 5" x .250"', false, null),
  ('recttube-3x6x-188', 'recttube', '3" x 6" x .188"', false, null),
  ('recttube-3x6x-250', 'recttube', '3" x 6" x .250"', false, null),
  ('recttube-4x6x-188', 'recttube', '4" x 6" x .188"', false, null),
  ('recttube-4x6x-250', 'recttube', '4" x 6" x .250"', false, null),
  ('recttube-4x8x-250', 'recttube', '4" x 8" x .250"', false, null),
  -- Structural square tube (HSS)
  ('squaretube-1x-125', 'squaretube', '1" x .125"', false, null),
  ('squaretube-1-5x-125', 'squaretube', '1.5" x .125"', false, null),
  ('squaretube-1-5x-188', 'squaretube', '1.5" x .188"', false, null),
  ('squaretube-2x-125', 'squaretube', '2" x .125"', false, null),
  ('squaretube-2x-188', 'squaretube', '2" x .188"', false, null),
  ('squaretube-2x-250', 'squaretube', '2" x .250"', false, null),
  ('squaretube-2-5x-125', 'squaretube', '2.5" x .125"', false, null),
  ('squaretube-2-5x-188', 'squaretube', '2.5" x .188"', false, null),
  ('squaretube-2-5x-250', 'squaretube', '2.5" x .250"', false, null),
  ('squaretube-3x-125', 'squaretube', '3" x .125"', false, null),
  ('squaretube-3x-188', 'squaretube', '3" x .188"', false, null),
  ('squaretube-3x-250', 'squaretube', '3" x .250"', false, null),
  ('squaretube-4x-188', 'squaretube', '4" x .188"', false, null),
  ('squaretube-4x-250', 'squaretube', '4" x .250"', false, null),
  ('squaretube-5x-250', 'squaretube', '5" x .250"', false, null),
  ('squaretube-6x-250', 'squaretube', '6" x .250"', false, null),
  -- Round bar for pins
  ('roundbar-1-75', 'roundbar', '1.75"', false, null),
  ('roundbar-2-25', 'roundbar', '2.25"', false, null);

-- Wood: a substance and a lumber shape
INSERT INTO "materialSubstance" ("id", "name", "code", "createdBy") VALUES
  ('wood', 'Wood', 'WOOD', 'system');

INSERT INTO "materialForm" ("id", "name", "code", "createdBy") VALUES
  ('lumber', 'Lumber', 'LUMBER', 'system');

-- Lumber in nominal sizes, as it is ordered
INSERT INTO "materialDimension" ("id", "materialFormId", "name", "isMetric", "companyId") VALUES
  ('lumber-1x4', 'lumber', '1" x 4"', false, null),
  ('lumber-1x6', 'lumber', '1" x 6"', false, null),
  ('lumber-1x8', 'lumber', '1" x 8"', false, null),
  ('lumber-1x10', 'lumber', '1" x 10"', false, null),
  ('lumber-1x12', 'lumber', '1" x 12"', false, null),
  ('lumber-2x4', 'lumber', '2" x 4"', false, null),
  ('lumber-2x6', 'lumber', '2" x 6"', false, null),
  ('lumber-2x8', 'lumber', '2" x 8"', false, null),
  ('lumber-2x10', 'lumber', '2" x 10"', false, null),
  ('lumber-2x12', 'lumber', '2" x 12"', false, null),
  ('lumber-4x4', 'lumber', '4" x 4"', false, null),
  ('lumber-4x6', 'lumber', '4" x 6"', false, null),
  ('lumber-6x6', 'lumber', '6" x 6"', false, null);

-- Species and grade
INSERT INTO "materialGrade" ("id", "materialSubstanceId", "name", "companyId") VALUES
  ('wood-syp-no1', 'wood', 'SYP #1', null),
  ('wood-syp-no2', 'wood', 'SYP #2', null),
  ('wood-df-no2', 'wood', 'DF #2', null),
  ('wood-spf-no2', 'wood', 'SPF #2', null),
  ('wood-red-oak', 'wood', 'Red Oak', null),
  ('wood-white-oak', 'wood', 'White Oak', null),
  ('wood-apitong', 'wood', 'Apitong', null);

-- Treatment
INSERT INTO "materialType" ("id", "name", "code", "materialSubstanceId", "materialFormId", "companyId") VALUES
  ('pressure-treated-wood-lumber', 'Pressure Treated', 'PT', 'wood', 'lumber', null),
  ('kiln-dried-wood-lumber', 'Kiln Dried', 'KD', 'wood', 'lumber', null),
  ('green-wood-lumber', 'Green', 'GR', 'wood', 'lumber', null);

-- Surfacing
INSERT INTO "materialFinish" ("id", "name", "materialSubstanceId", "companyId") VALUES
  ('s4s-wood', 'S4S', 'wood', null),
  ('rough-sawn-wood', 'Rough Sawn', 'wood', null);
