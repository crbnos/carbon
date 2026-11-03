ALTER TABLE "supplier" ADD COLUMN "requireContactEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer" ADD COLUMN "requireContactEmail" BOOLEAN NOT NULL DEFAULT false;
