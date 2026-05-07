ALTER TABLE "invite" ADD COLUMN "revokedAt" TIMESTAMPTZ;

DROP INDEX IF EXISTS "invite_unaccepted_code_idx";
CREATE INDEX "invite_redeemable_code_idx" ON "invite" ("code")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
