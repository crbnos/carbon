-- Make API key rate limits platform-controlled only (not user-configurable).
-- Default: 60 requests per 60 seconds (1 minute).

-- Update column defaults
ALTER TABLE "apiKey"
  ALTER COLUMN "rateLimit" SET DEFAULT 60,
  ALTER COLUMN "rateLimitWindow" SET DEFAULT '1m';

-- Migrate all existing API keys to the new default
UPDATE "apiKey"
SET "rateLimit" = 60,
    "rateLimitWindow" = '1m';
