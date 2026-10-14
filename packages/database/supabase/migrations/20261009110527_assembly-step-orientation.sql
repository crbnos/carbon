-- The build's orientation from this step on: a unit quaternion [x, y, z, w]
-- that turns the model frame into the bench frame. Applied by the 3D player
-- in the ERP editor and in MES. NULL = same as the previous step in the
-- same build (main build or sub-assembly); a sub-assembly starts upright.
ALTER TABLE "assemblyInstructionStep"
  ADD COLUMN IF NOT EXISTS "orientation" JSONB;
