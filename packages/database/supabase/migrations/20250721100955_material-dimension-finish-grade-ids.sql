-- Add new ID columns for dimension, finish, and grade
ALTER TABLE "material" 
  ADD COLUMN "dimensionId" TEXT,
  ADD COLUMN "finishId" TEXT,
  ADD COLUMN "gradeId" TEXT;

-- Add foreign key constraints
ALTER TABLE "material"
  ADD CONSTRAINT "material_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "materialDimension"("id"),
  ADD CONSTRAINT "material_finishId_fkey" FOREIGN KEY ("finishId") REFERENCES "materialFinish"("id"),
  ADD CONSTRAINT "material_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "materialGrade"("id");

-- Create indexes for better performance
CREATE INDEX "material_dimensionId_idx" ON "material"("dimensionId");
CREATE INDEX "material_finishId_idx" ON "material"("finishId");
CREATE INDEX "material_gradeId_idx" ON "material"("gradeId");