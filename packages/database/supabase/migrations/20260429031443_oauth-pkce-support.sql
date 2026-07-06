-- Add PKCE support to OAuth authorization codes
ALTER TABLE "oauthCode" ADD COLUMN "codeChallenge" TEXT;
ALTER TABLE "oauthCode" ADD COLUMN "codeChallengeMethod" TEXT CHECK ("codeChallengeMethod" IN ('S256', 'plain'));
ALTER TABLE "oauthCode" ADD COLUMN "scope" TEXT;

-- Add scope column for OAuth tokens
ALTER TABLE "oauthToken" ADD COLUMN "scope" TEXT;

-- Extend oauthClient to support dynamic registration and public clients
ALTER TABLE "oauthClient" ALTER COLUMN "clientSecret" DROP NOT NULL;
ALTER TABLE "oauthClient" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "oauthClient" ADD COLUMN "grantTypes" TEXT[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token'];
ALTER TABLE "oauthClient" ADD COLUMN "responseTypes" TEXT[] NOT NULL DEFAULT ARRAY['code'];
ALTER TABLE "oauthClient" ADD COLUMN "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'client_secret_post';
ALTER TABLE "oauthClient" ADD COLUMN "clientUri" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "logoUri" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "scope" TEXT;
