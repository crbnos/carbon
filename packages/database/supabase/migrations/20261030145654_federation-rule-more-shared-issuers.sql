-- HCP Terraform and Buildkite also sign tokens for every customer, with
-- name-based subjects. Require their immutable organization id claims, as
-- SHARED_ISSUER_REQUIREMENTS (packages/ee/src/federation/constants.ts) does.
ALTER TABLE "federationRule"
  DROP CONSTRAINT IF EXISTS "federationRule_sharedIssuer_check";

ALTER TABLE "federationRule"
  ADD CONSTRAINT "federationRule_sharedIssuer_check" CHECK (
    (rtrim("issuer", '/') <> 'https://token.actions.githubusercontent.com'
      OR "claimConditions" ? 'repository_owner_id')
    AND (rtrim("issuer", '/') <> 'https://gitlab.com'
      OR "claimConditions" ? 'namespace_id')
    AND (rtrim("issuer", '/') <> 'https://app.terraform.io'
      OR "claimConditions" ? 'terraform_organization_id')
    AND (rtrim("issuer", '/') <> 'https://agent.buildkite.com'
      OR "claimConditions" ? 'organization_id')
    AND (rtrim("issuer", '/') <> 'https://accounts.google.com'
      OR ("subject" IS NOT NULL AND "subject" NOT LIKE '%*'))
  );
