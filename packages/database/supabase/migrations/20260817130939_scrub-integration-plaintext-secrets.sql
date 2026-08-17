-- NIST 800-171 3.13.16: final step — remove the plaintext secrets from
-- companyIntegration.metadata now that they live in Supabase Vault (backfill,
-- plan Task 9). Only scrub rows we actually vaulted (secretRef IS NOT NULL), so
-- a row whose secret was never vaulted is never stripped-and-lost.
--
-- metadata is a JSON column; `#-` (path delete) is a jsonb operator, so cast
-- json -> jsonb -> json around each removal. Paths mirror SECRET_KEYS exactly.

-- Top-level {apiKey}
UPDATE "companyIntegration"
SET metadata = ((metadata::jsonb) #- '{apiKey}')::json
WHERE id IN ('linear', 'resend') AND "secretRef" IS NOT NULL;

-- paperless-parts: {apiKey} + {secretKey}
UPDATE "companyIntegration"
SET metadata = (((metadata::jsonb) #- '{apiKey}') #- '{secretKey}')::json
WHERE id = 'paperless-parts' AND "secretRef" IS NOT NULL;

-- email: {apiKey} (Resend) + {password} (SMTP)
UPDATE "companyIntegration"
SET metadata = (((metadata::jsonb) #- '{apiKey}') #- '{password}')::json
WHERE id = 'email' AND "secretRef" IS NOT NULL;

-- slack: {access_token}
UPDATE "companyIntegration"
SET metadata = ((metadata::jsonb) #- '{access_token}')::json
WHERE id = 'slack' AND "secretRef" IS NOT NULL;

-- oauth2 providers: {credentials,accessToken} + {credentials,refreshToken}
UPDATE "companyIntegration"
SET metadata = (((metadata::jsonb) #- '{credentials,accessToken}') #- '{credentials,refreshToken}')::json
WHERE id IN ('jira', 'onshape', 'xero', 'quickbooks') AND "secretRef" IS NOT NULL;

-- rillet: {credentials,apiKey} + {credentials,providerMetadata,webhookToken}
UPDATE "companyIntegration"
SET metadata = (((metadata::jsonb) #- '{credentials,apiKey}') #- '{credentials,providerMetadata,webhookToken}')::json
WHERE id = 'rillet' AND "secretRef" IS NOT NULL;
