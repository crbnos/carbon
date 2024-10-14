ALTER TABLE "item"
  ADD COLUMN "externalId" JSONB;

ALTER TABLE "part"
  ADD COLUMN "externalId" JSONB;

ALTER TABLE "material"
  ADD COLUMN "externalId" JSONB;

ALTER TABLE "tool"
  ADD COLUMN "externalId" JSONB;

ALTER TABLE "fixture"
  ADD COLUMN "externalId" JSONB;

ALTER TABLE "consumable"
  ADD COLUMN "externalId" JSONB;
