-- Federation rule hardening, from the branch review of
-- 20261030122219_federation-rule.sql. The checks the app runs before a rule
-- write now also hold in the database, so no write path can skip them.

DO $$
BEGIN
  -- Issuers that sign tokens for every customer need a claim that never
  -- changes when a name does (PyPI, npm "SlugFest"): GitHub's owner id,
  -- GitLab.com's namespace id, Google's exact numeric subject.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'federationRule_sharedIssuer_check'
  ) THEN
    ALTER TABLE "federationRule"
      ADD CONSTRAINT "federationRule_sharedIssuer_check" CHECK (
        (rtrim("issuer", '/') <> 'https://token.actions.githubusercontent.com'
          OR "claimConditions" ? 'repository_owner_id')
        AND (rtrim("issuer", '/') <> 'https://gitlab.com'
          OR "claimConditions" ? 'namespace_id')
        AND (rtrim("issuer", '/') <> 'https://accounts.google.com'
          OR ("subject" IS NOT NULL AND "subject" NOT LIKE '%*'))
      );
  END IF;

  -- A prefix ends at a separator: `repo:acme/plm:*`, never `org:acme*`,
  -- which would also match `org:acme-evil`.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'federationRule_subjectPrefix_check'
  ) THEN
    ALTER TABLE "federationRule"
      ADD CONSTRAINT "federationRule_subjectPrefix_check" CHECK (
        "subject" IS NULL OR "subject" NOT LIKE '%*' OR "subject" ~ '[:/]\*$'
      );
  END IF;

  -- A minted key always expires: an edit must not turn it into a hidden,
  -- permanent key the purge never reaches.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'apiKey_federatedExpiry_check'
  ) THEN
    ALTER TABLE "apiKey"
      ADD CONSTRAINT "apiKey_federatedExpiry_check"
      CHECK ("federationRuleId" IS NULL OR "expiresAt" IS NOT NULL);
  END IF;

  -- The minted key and its rule belong to one company.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'apiKey_federationRuleId_fkey'
      AND array_length(conkey, 1) = 2
  ) THEN
    ALTER TABLE "apiKey" DROP CONSTRAINT IF EXISTS "apiKey_federationRuleId_fkey";
    ALTER TABLE "apiKey"
      ADD CONSTRAINT "apiKey_federationRuleId_fkey"
      FOREIGN KEY ("federationRuleId", "companyId")
      REFERENCES "federationRule"("id", "companyId")
      ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "federationRule_updatedBy_idx"
  ON "federationRule" ("updatedBy");
