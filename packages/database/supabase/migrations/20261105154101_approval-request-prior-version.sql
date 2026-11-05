-- The document as it was before the change a request is for. A purchase order
-- edited above its approved amount goes back to approval with the version it
-- had just before that edit; rejecting the request restores it. Null for a
-- first approval, which has nothing to go back to.
ALTER TABLE "approvalRequest"
  ADD COLUMN IF NOT EXISTS "priorVersion" JSONB;
