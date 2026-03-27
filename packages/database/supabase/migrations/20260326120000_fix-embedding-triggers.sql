-- =============================================================================
-- Fix Embedding Pipeline via Event System
-- The search-refactor migration (20260109) dropped trigger functions that had
-- dual responsibility: updating the old search table AND queuing embedding jobs.
-- Instead of re-creating standalone triggers, this migration integrates embeddings
-- into the existing event system as a new EMBEDDING handler type.
-- =============================================================================

-- =============================================================================
-- PART 1: Add EMBEDDING to handlerType enum
-- =============================================================================

ALTER TABLE "eventSystemSubscription"
DROP CONSTRAINT IF EXISTS "eventSystemSubscription_handlerType_check";

ALTER TABLE "eventSystemSubscription"
ADD CONSTRAINT "eventSystemSubscription_handlerType_check"
CHECK ("handlerType" IN ('WEBHOOK', 'WORKFLOW', 'SYNC', 'SEARCH', 'AUDIT', 'EMBEDDING'));

-- =============================================================================
-- PART 2: Create embedding subscriptions for all existing companies
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_embedding_subscriptions_for_company(p_company_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_tables TEXT[] := ARRAY['item', 'customer', 'supplier'];
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    INSERT INTO "eventSystemSubscription" (
      "name",
      "table",
      "companyId",
      "operations",
      "handlerType",
      "config",
      "filter",
      "active"
    )
    VALUES (
      'embedding-' || v_table,
      v_table,
      p_company_id,
      ARRAY['INSERT', 'UPDATE'],
      'EMBEDDING',
      '{}'::jsonb,
      '{}'::jsonb,
      TRUE
    )
    ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company"
    DO UPDATE SET
      "operations" = EXCLUDED."operations",
      "handlerType" = EXCLUDED."handlerType",
      "active" = EXCLUDED."active";
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Backfill subscriptions for all existing companies
DO $$
DECLARE
  company_record RECORD;
BEGIN
  FOR company_record IN SELECT id FROM "company" LOOP
    PERFORM create_embedding_subscriptions_for_company(company_record.id);
  END LOOP;
END $$;

-- =============================================================================
-- PART 3: Update company creation trigger to also create embedding subscriptions
-- =============================================================================

CREATE OR REPLACE FUNCTION on_company_created_search_index()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_company_search_index(NEW.id);
  PERFORM create_search_subscriptions_for_company(NEW.id);
  PERFORM create_embedding_subscriptions_for_company(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- PART 4: Backfill existing records with null embeddings
-- =============================================================================

SELECT pgmq.send(
  'embedding_jobs',
  jsonb_build_object(
    'id', id,
    'table', 'item'
  )
)
FROM item
WHERE embedding IS NULL;

SELECT pgmq.send(
  'embedding_jobs',
  jsonb_build_object(
    'id', id,
    'table', 'supplier'
  )
)
FROM supplier
WHERE embedding IS NULL;

SELECT pgmq.send(
  'embedding_jobs',
  jsonb_build_object(
    'id', id,
    'table', 'customer'
  )
)
FROM customer
WHERE embedding IS NULL;
