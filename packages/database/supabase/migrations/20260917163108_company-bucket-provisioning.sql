-- Company-private buckets: provisioning.
-- 20250827181005_company-bucket-rls.sql backfilled one bucket per company that
-- existed at the time and created the "Company bucket access" RLS policy, but
-- nothing creates a bucket for a company created since. Backfill the gap and
-- add an AFTER INSERT trigger so every new company gets its bucket atomically.

-- Belt-and-braces: a company id equal to a shared bucket id would silently
-- collide with that bucket (the provisioning below no-ops on conflict) while
-- the "Company bucket access" RLS policy (20250827181005) would then grant
-- that company's employees FOR ALL on the shared bucket. Generated ids can
-- never take these values; refuse them outright so no insert path ever can.
ALTER TABLE "company" ADD CONSTRAINT "company_id_not_reserved_bucket_id"
  CHECK ("id" NOT IN ('private', 'public', 'avatars', 'feedback', 'temp-staging', 'company-templates'));

-- Backfill buckets for companies created after 20250827181005 (50 MB cap,
-- matching the limit 20260715150742 put on the legacy "private" bucket).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
SELECT id, id, false, 52428800
FROM company
ON CONFLICT (id) DO NOTHING;

-- The 2025 backfill created rows with a NULL file_size_limit; normalize.
UPDATE storage.buckets
SET file_size_limit = 52428800
WHERE id IN (SELECT id FROM company)
  AND file_size_limit IS NULL;

-- SECURITY DEFINER: the inserting role (authenticated user during onboarding)
-- has no grant on storage.buckets.
CREATE OR REPLACE FUNCTION public.create_company_private_bucket()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES (NEW.id, NEW.id, false, 52428800)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage;

CREATE TRIGGER create_company_private_bucket_trigger
AFTER INSERT ON "company"
FOR EACH ROW EXECUTE FUNCTION public.create_company_private_bucket();
