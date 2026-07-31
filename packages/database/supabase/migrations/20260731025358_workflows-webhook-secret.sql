-- A per-workflow signing secret for the "call an outside URL" action
-- Postgres has no column-level RLS: anyone who can read the workflow can read the secret

ALTER TABLE "workflow"
  ADD COLUMN "webhookSecret" TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex');
