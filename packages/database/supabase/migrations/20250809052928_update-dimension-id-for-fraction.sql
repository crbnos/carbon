

-- Drop foreign key constraints that reference materialDimension, materialFinish, and materialGrade to allow ID updates
ALTER TABLE "material" DROP CONSTRAINT IF EXISTS "material_dimensionId_fkey";
ALTER TABLE "material" DROP CONSTRAINT IF EXISTS "material_finishId_fkey";
ALTER TABLE "material" DROP CONSTRAINT IF EXISTS "material_gradeId_fkey";

-- Add the constraints back with ON DELETE SET NULL
ALTER TABLE "material"
  ADD CONSTRAINT "material_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "materialDimension"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "material_finishId_fkey" FOREIGN KEY ("finishId") REFERENCES "materialFinish"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "material_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "materialGrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
-- Update dimension IDs to use forward slash for fractions
-- Going through each fraction dimension one by one

-- Sheet dimensions - Imperial fractions
UPDATE "materialDimension" 
SET "id" = 'sheet-1/32'
WHERE "id" = 'sheet-1-32';

UPDATE "materialDimension" 
SET "id" = 'sheet-3/64'
WHERE "id" = 'sheet-3-64';

UPDATE "materialDimension" 
SET "id" = 'sheet-1/16'
WHERE "id" = 'sheet-1-16';

UPDATE "materialDimension" 
SET "id" = 'sheet-5/64'
WHERE "id" = 'sheet-5-64';

UPDATE "materialDimension" 
SET "id" = 'sheet-3/32'
WHERE "id" = 'sheet-3-32';

-- Plate dimensions - Imperial fractions
UPDATE "materialDimension" 
SET "id" = 'plate-1/8'
WHERE "id" = 'plate-1-8';

UPDATE "materialDimension" 
SET "id" = 'plate-3/16'
WHERE "id" = 'plate-3-16';

UPDATE "materialDimension" 
SET "id" = 'plate-1/4'
WHERE "id" = 'plate-1-4';

UPDATE "materialDimension" 
SET "id" = 'plate-5/16'
WHERE "id" = 'plate-5-16';

UPDATE "materialDimension" 
SET "id" = 'plate-3/8'
WHERE "id" = 'plate-3-8';

UPDATE "materialDimension" 
SET "id" = 'plate-1/2'
WHERE "id" = 'plate-1-2';

UPDATE "materialDimension" 
SET "id" = 'plate-5/8'
WHERE "id" = 'plate-5-8';

UPDATE "materialDimension" 
SET "id" = 'plate-3/4'
WHERE "id" = 'plate-3-4';

-- Round bar dimensions - Imperial fractions
UPDATE "materialDimension" 
SET "id" = 'roundbar-1/8'
WHERE "id" = 'roundbar-1-8';

UPDATE "materialDimension" 
SET "id" = 'roundbar-3/16'
WHERE "id" = 'roundbar-3-16';

UPDATE "materialDimension" 
SET "id" = 'roundbar-1/4'
WHERE "id" = 'roundbar-1-4';

UPDATE "materialDimension" 
SET "id" = 'roundbar-5/16'
WHERE "id" = 'roundbar-5-16';

UPDATE "materialDimension" 
SET "id" = 'roundbar-3/8'
WHERE "id" = 'roundbar-3-8';

UPDATE "materialDimension" 
SET "id" = 'roundbar-1/2'
WHERE "id" = 'roundbar-1-2';

UPDATE "materialDimension" 
SET "id" = 'roundbar-5/8'
WHERE "id" = 'roundbar-5-8';

UPDATE "materialDimension" 
SET "id" = 'roundbar-3/4'
WHERE "id" = 'roundbar-3-4';

UPDATE "materialDimension" 
SET "id" = 'roundbar-7/8'
WHERE "id" = 'roundbar-7-8';

-- Square bar dimensions - Imperial fractions
UPDATE "materialDimension" 
SET "id" = 'squarebar-1/8'
WHERE "id" = 'squarebar-1-8';

UPDATE "materialDimension" 
SET "id" = 'squarebar-3/16'
WHERE "id" = 'squarebar-3-16';

UPDATE "materialDimension" 
SET "id" = 'squarebar-1/4'
WHERE "id" = 'squarebar-1-4';

UPDATE "materialDimension" 
SET "id" = 'squarebar-5/16'
WHERE "id" = 'squarebar-5-16';

UPDATE "materialDimension" 
SET "id" = 'squarebar-3/8'
WHERE "id" = 'squarebar-3-8';

UPDATE "materialDimension" 
SET "id" = 'squarebar-1/2'
WHERE "id" = 'squarebar-1-2';

UPDATE "materialDimension" 
SET "id" = 'squarebar-5/8'
WHERE "id" = 'squarebar-5-8';

UPDATE "materialDimension" 
SET "id" = 'squarebar-3/4'
WHERE "id" = 'squarebar-3-4';

-- Hex bar dimensions - Imperial fractions
UPDATE "materialDimension" 
SET "id" = 'hexbar-1/4'
WHERE "id" = 'hexbar-1-4';

UPDATE "materialDimension" 
SET "id" = 'hexbar-5/16'
WHERE "id" = 'hexbar-5-16';

UPDATE "materialDimension" 
SET "id" = 'hexbar-3/8'
WHERE "id" = 'hexbar-3-8';

UPDATE "materialDimension" 
SET "id" = 'hexbar-1/2'
WHERE "id" = 'hexbar-1-2';

UPDATE "materialDimension" 
SET "id" = 'hexbar-5/8'
WHERE "id" = 'hexbar-5-8';

UPDATE "materialDimension" 
SET "id" = 'hexbar-3/4'
WHERE "id" = 'hexbar-3-4';

UPDATE "materialDimension" 
SET "id" = 'hexbar-7/8'
WHERE "id" = 'hexbar-7-8';

-- Flat bar dimensions - Imperial fractions (complex patterns)
UPDATE "materialDimension" 
SET "id" = 'flatbar-1/8x1/2'
WHERE "id" = 'flatbar-1-8x1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/8x3/4'
WHERE "id" = 'flatbar-1-8x3-4';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/8x1'
WHERE "id" = 'flatbar-1-8x1';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/16x1/2'
WHERE "id" = 'flatbar-3-16x1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/16x3/4'
WHERE "id" = 'flatbar-3-16x3-4';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/16x1'
WHERE "id" = 'flatbar-3-16x1';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/4x1/2'
WHERE "id" = 'flatbar-1-4x1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/4x3/4'
WHERE "id" = 'flatbar-1-4x3-4';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/4x1'
WHERE "id" = 'flatbar-1-4x1';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/4x1-1/2'
WHERE "id" = 'flatbar-1-4x1-1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/4x2'
WHERE "id" = 'flatbar-1-4x2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/16x1/2'
WHERE "id" = 'flatbar-5-16x1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/16x3/4'
WHERE "id" = 'flatbar-5-16x3-4';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/16x1'
WHERE "id" = 'flatbar-5-16x1';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/16x1-1/2'
WHERE "id" = 'flatbar-5-16x1-1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/16x2'
WHERE "id" = 'flatbar-5-16x2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/8x1/2'
WHERE "id" = 'flatbar-3-8x1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/8x3/4'
WHERE "id" = 'flatbar-3-8x3-4';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/8x1'
WHERE "id" = 'flatbar-3-8x1';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/8x1-1/2'
WHERE "id" = 'flatbar-3-8x1-1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/8x2'
WHERE "id" = 'flatbar-3-8x2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/8x3'
WHERE "id" = 'flatbar-3-8x3';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/2x3/4'
WHERE "id" = 'flatbar-1-2x3-4';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/2x1'
WHERE "id" = 'flatbar-1-2x1';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/2x1-1/2'
WHERE "id" = 'flatbar-1-2x1-1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/2x2'
WHERE "id" = 'flatbar-1-2x2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/2x3'
WHERE "id" = 'flatbar-1-2x3';

UPDATE "materialDimension" 
SET "id" = 'flatbar-1/2x4'
WHERE "id" = 'flatbar-1-2x4';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/8x1'
WHERE "id" = 'flatbar-5-8x1';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/8x1-1/2'
WHERE "id" = 'flatbar-5-8x1-1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/8x2'
WHERE "id" = 'flatbar-5-8x2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/8x3'
WHERE "id" = 'flatbar-5-8x3';

UPDATE "materialDimension" 
SET "id" = 'flatbar-5/8x4'
WHERE "id" = 'flatbar-5-8x4';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/4x1'
WHERE "id" = 'flatbar-3-4x1';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/4x1-1/2'
WHERE "id" = 'flatbar-3-4x1-1-2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/4x2'
WHERE "id" = 'flatbar-3-4x2';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/4x3'
WHERE "id" = 'flatbar-3-4x3';

UPDATE "materialDimension" 
SET "id" = 'flatbar-3/4x4'
WHERE "id" = 'flatbar-3-4x4';

-- Angle dimensions - Imperial fractions (complex patterns)
UPDATE "materialDimension" 
SET "id" = 'angle-1/2x1/2x1/8'
WHERE "id" = 'angle-1-2x1-2x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-3/4x3/4x1/8'
WHERE "id" = 'angle-3-4x3-4x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-1x1x1/8'
WHERE "id" = 'angle-1x1x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-1x1x3/16'
WHERE "id" = 'angle-1x1x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-1-1/4x1-1/4x3/16'
WHERE "id" = 'angle-1-1-4x1-1-4x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-1-1/2x1-1/2x3/16'
WHERE "id" = 'angle-1-1-2x1-1-2x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-1-1/2x1-1/2x1/4'
WHERE "id" = 'angle-1-1-2x1-1-2x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x1/8'
WHERE "id" = 'angle-2x2x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x3/16'
WHERE "id" = 'angle-2x2x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x1/4'
WHERE "id" = 'angle-2x2x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x5/16'
WHERE "id" = 'angle-2x2x5-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x3/8'
WHERE "id" = 'angle-2x2x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-2-1/2x2-1/2x3/16'
WHERE "id" = 'angle-2-1-2x2-1-2x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2-1/2x2-1/2x1/4'
WHERE "id" = 'angle-2-1-2x2-1-2x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2-1/2x2-1/2x5/16'
WHERE "id" = 'angle-2-1-2x2-1-2x5-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2-1/2x2-1/2x3/8'
WHERE "id" = 'angle-2-1-2x2-1-2x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x3/16'
WHERE "id" = 'angle-3x3x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x1/4'
WHERE "id" = 'angle-3x3x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x5/16'
WHERE "id" = 'angle-3x3x5-16';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x3/8'
WHERE "id" = 'angle-3x3x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x1/2'
WHERE "id" = 'angle-3x3x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-3-1/2x3-1/2x1/4'
WHERE "id" = 'angle-3-1-2x3-1-2x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-3-1/2x3-1/2x5/16'
WHERE "id" = 'angle-3-1-2x3-1-2x5-16';

UPDATE "materialDimension" 
SET "id" = 'angle-3-1/2x3-1/2x3/8'
WHERE "id" = 'angle-3-1-2x3-1-2x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-3-1/2x3-1/2x1/2'
WHERE "id" = 'angle-3-1-2x3-1-2x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x1/4'
WHERE "id" = 'angle-4x4x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x5/16'
WHERE "id" = 'angle-4x4x5-16';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x3/8'
WHERE "id" = 'angle-4x4x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x1/2'
WHERE "id" = 'angle-4x4x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-5x5x5/16'
WHERE "id" = 'angle-5x5x5-16';

UPDATE "materialDimension" 
SET "id" = 'angle-5x5x3/8'
WHERE "id" = 'angle-5x5x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-5x5x1/2'
WHERE "id" = 'angle-5x5x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-6x6x3/8'
WHERE "id" = 'angle-6x6x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-6x6x1/2'
WHERE "id" = 'angle-6x6x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-6x6x5/8'
WHERE "id" = 'angle-6x6x5-8';

UPDATE "materialDimension" 
SET "id" = 'angle-6x6x3/4'
WHERE "id" = 'angle-6x6x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-8x8x1/2'
WHERE "id" = 'angle-8x8x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-8x8x5/8'
WHERE "id" = 'angle-8x8x5-8';

UPDATE "materialDimension" 
SET "id" = 'angle-8x8x3/4'
WHERE "id" = 'angle-8x8x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-8x8x1'
WHERE "id" = 'angle-8x8x1';

UPDATE "materialDimension" 
SET "id" = 'angle-8x4x1/2'
WHERE "id" = 'angle-8x4x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-8x4x3/4'
WHERE "id" = 'angle-8x4x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-8x4x1'
WHERE "id" = 'angle-8x4x1';

UPDATE "materialDimension" 
SET "id" = 'angle-8x6x1/2'
WHERE "id" = 'angle-8x6x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-8x6x3/4'
WHERE "id" = 'angle-8x6x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-8x6x1'
WHERE "id" = 'angle-8x6x1';

-- Additional angle dimensions with fractional patterns not previously covered
UPDATE "materialDimension" 
SET "id" = 'angle-1x1x1/4'
WHERE "id" = 'angle-1x1x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-5/8x5/8x1/8'
WHERE "id" = 'angle-5-8x5-8x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-1.25x1.25x1/8'
WHERE "id" = 'angle-1-25x1-25x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-1.25x1.25x3/16'
WHERE "id" = 'angle-1-25x1-25x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-1.25x1.25x1/4'
WHERE "id" = 'angle-1-25x1-25x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-1.5x1.5x1/8'
WHERE "id" = 'angle-1-5x1-5x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-1.5x1.5x3/16'
WHERE "id" = 'angle-1-5x1-5x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-1.5x1.5x1/4'
WHERE "id" = 'angle-1-5x1-5x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-1.75x1.75x1/8'
WHERE "id" = 'angle-1-75x1-75x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-1.75x1.75x3/16'
WHERE "id" = 'angle-1-75x1-75x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-1.75x1.75x1/4'
WHERE "id" = 'angle-1-75x1-75x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2x1.5x1/8'
WHERE "id" = 'angle-2x1-5x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-2x1.5x3/16'
WHERE "id" = 'angle-2x1-5x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2x1.5x1/4'
WHERE "id" = 'angle-2x1-5x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2.5x1.5x3/16'
WHERE "id" = 'angle-2-5x1-5x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2.5x1.5x1/4'
WHERE "id" = 'angle-2-5x1-5x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2.5x2x1/4'
WHERE "id" = 'angle-2-5x2x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2.5x2x5/16'
WHERE "id" = 'angle-2-5x2x5-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2.5x2.5x3/16'
WHERE "id" = 'angle-2-5x2-5x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2.5x2.5x1/4'
WHERE "id" = 'angle-2-5x2-5x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2.5x2.5x3/8'
WHERE "id" = 'angle-2-5x2-5x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-2.5x2.5x1/2'
WHERE "id" = 'angle-2-5x2-5x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-3x2x1/2'
WHERE "id" = 'angle-3x2x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-3x2x1/4'
WHERE "id" = 'angle-3x2x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-3x2x3/16'
WHERE "id" = 'angle-3x2x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-3x2x3/8'
WHERE "id" = 'angle-3x2x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-3.5x3.5x1/4'
WHERE "id" = 'angle-3-5x3-5x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-3.5x3.5x3/8'
WHERE "id" = 'angle-3-5x3-5x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-4x3x1/2'
WHERE "id" = 'angle-4x3x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-4x3x1/4'
WHERE "id" = 'angle-4x3x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-4x3x3/8'
WHERE "id" = 'angle-4x3x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-4x3.5x1/2'
WHERE "id" = 'angle-4x3-5x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x3/4'
WHERE "id" = 'angle-4x4x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x5/8'
WHERE "id" = 'angle-4x4x5-8';

UPDATE "materialDimension" 
SET "id" = 'angle-5x3x1/2'
WHERE "id" = 'angle-5x3x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-5x3x1/4'
WHERE "id" = 'angle-5x3x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-5x3x3/8'
WHERE "id" = 'angle-5x3x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-5x3.5x1/4'
WHERE "id" = 'angle-5x3-5x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-5x3.5x5/16'
WHERE "id" = 'angle-5x3-5x5-16';

UPDATE "materialDimension" 
SET "id" = 'angle-5x3.5x3/8'
WHERE "id" = 'angle-5x3-5x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-6x4x1/2'
WHERE "id" = 'angle-6x4x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-6x4x3/4'
WHERE "id" = 'angle-6x4x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-6x4x3/8'
WHERE "id" = 'angle-6x4x3-8';

-- Billet dimensions with fractional patterns
UPDATE "materialDimension" 
SET "id" = 'billet-1.5x1.5'
WHERE "id" = 'billet-1-5x1-5';

UPDATE "materialDimension" 
SET "id" = 'billet-round-1.5'
WHERE "id" = 'billet-round-1-5';

-- Additional missing angle dimensions with dash separators that weren't covered
UPDATE "materialDimension" 
SET "id" = 'angle-1x1x1/8'
WHERE "id" = 'angle-1x1x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-1x1x3/16'
WHERE "id" = 'angle-1x1x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x1/8'
WHERE "id" = 'angle-2x2x1-8';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x3/16'
WHERE "id" = 'angle-2x2x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x1/4'
WHERE "id" = 'angle-2x2x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-2x2x3/8'
WHERE "id" = 'angle-2x2x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x3/16'
WHERE "id" = 'angle-3x3x3-16';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x1/4'
WHERE "id" = 'angle-3x3x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x3/8'
WHERE "id" = 'angle-3x3x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-3x3x1/2'
WHERE "id" = 'angle-3x3x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x1/4'
WHERE "id" = 'angle-4x4x1-4';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x3/8'
WHERE "id" = 'angle-4x4x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x1/2'
WHERE "id" = 'angle-4x4x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x5/8'
WHERE "id" = 'angle-4x4x5-8';

UPDATE "materialDimension" 
SET "id" = 'angle-4x4x3/4'
WHERE "id" = 'angle-4x4x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-5x5x3/8'
WHERE "id" = 'angle-5x5x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-5x5x1/2'
WHERE "id" = 'angle-5x5x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-6x6x3/8'
WHERE "id" = 'angle-6x6x3-8';

UPDATE "materialDimension" 
SET "id" = 'angle-6x6x1/2'
WHERE "id" = 'angle-6x6x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-6x6x5/8'
WHERE "id" = 'angle-6x6x5-8';

UPDATE "materialDimension" 
SET "id" = 'angle-6x6x3/4'
WHERE "id" = 'angle-6x6x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-8x4x1/2'
WHERE "id" = 'angle-8x4x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-8x4x3/4'
WHERE "id" = 'angle-8x4x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-8x6x1/2'
WHERE "id" = 'angle-8x6x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-8x6x3/4'
WHERE "id" = 'angle-8x6x3-4';

UPDATE "materialDimension" 
SET "id" = 'angle-8x8x1/2'
WHERE "id" = 'angle-8x8x1-2';

UPDATE "materialDimension" 
SET "id" = 'angle-8x8x3/4'
WHERE "id" = 'angle-8x8x3-4';

