-- A scanned, individually identified input and the one job output it supplies.
-- Leaving released pairs in place preserves the history of scan corrections.
SET lock_timeout = '5s';

-- Existing unpaired jobs keep the workflow they were created under. Both
-- sides use the transaction timestamp so an atomic enable-and-create counts
-- as a new job. Turning the setting off and back on starts a new period.
ALTER TABLE public."companySettings" ADD COLUMN IF NOT EXISTS "serialNumberFromComponentEnabledAt" timestamptz;
UPDATE public."companySettings" SET "serialNumberFromComponentEnabledAt" = now()
WHERE "serialNumberFromComponent" AND "serialNumberFromComponentEnabledAt" IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_serial_number_from_component_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NOT NEW."serialNumberFromComponent" THEN
    NEW."serialNumberFromComponentEnabledAt" := NULL;
  ELSIF TG_OP = 'INSERT' OR NOT OLD."serialNumberFromComponent" THEN
    NEW."serialNumberFromComponentEnabledAt" := now();
  ELSE
    NEW."serialNumberFromComponentEnabledAt" := OLD."serialNumberFromComponentEnabledAt";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER stamp_serial_number_from_component_activation
BEFORE INSERT OR UPDATE OF "serialNumberFromComponent", "serialNumberFromComponentEnabledAt"
ON public."companySettings" FOR EACH ROW
EXECUTE FUNCTION public.stamp_serial_number_from_component_activation();

CREATE TABLE IF NOT EXISTS public."jobUnitPairing" (
  "id" TEXT NOT NULL DEFAULT id('jup'),
  "companyId" TEXT NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  "jobId" TEXT NOT NULL REFERENCES public.job(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  "jobMaterialId" TEXT REFERENCES public."jobMaterial"(id) ON DELETE SET NULL,
  "sourceId" TEXT NOT NULL REFERENCES public."trackedEntity"(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  "outputId" TEXT NOT NULL REFERENCES public."trackedEntity"(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  "serial" TEXT NOT NULL CHECK (btrim(serial) <> ''),
  -- An already typed, matching serial stays on the output when the input is returned.
  "assignedSerial" BOOLEAN NOT NULL DEFAULT true,
  "releasedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
  "updatedAt" TIMESTAMPTZ,
  "updatedBy" TEXT REFERENCES public."user"(id) ON DELETE RESTRICT,
  PRIMARY KEY ("id", "companyId"),
  CHECK ("sourceId" <> "outputId"),
  -- A method can be replaced after an issue has been corrected. A material
  -- which is still paired cannot be removed from beneath its packing job.
  CHECK ("jobMaterialId" IS NOT NULL OR "releasedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "jobUnitPairing_active_source" ON public."jobUnitPairing" ("companyId", "sourceId") WHERE "releasedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "jobUnitPairing_active_output" ON public."jobUnitPairing" ("companyId", "outputId") WHERE "releasedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "jobUnitPairing_job" ON public."jobUnitPairing" ("companyId", "jobId");
CREATE INDEX IF NOT EXISTS "jobUnitPairing_material" ON public."jobUnitPairing" ("jobMaterialId");
CREATE INDEX IF NOT EXISTS "jobUnitPairing_source" ON public."jobUnitPairing" ("sourceId");
CREATE INDEX IF NOT EXISTS "jobUnitPairing_output" ON public."jobUnitPairing" ("outputId");
CREATE INDEX IF NOT EXISTS "jobUnitPairing_createdBy" ON public."jobUnitPairing" ("createdBy");
CREATE INDEX IF NOT EXISTS "jobUnitPairing_updatedBy" ON public."jobUnitPairing" ("updatedBy");

ALTER TABLE public."jobUnitPairing" ENABLE ROW LEVEL SECURITY;

-- Use the job's own method and planned materials. Off-plan issues have a
-- quantity of zero. A job that already started pairing must finish or reverse
-- that work under the same rules even if the company changes its defaults.
CREATE OR REPLACE FUNCTION public.job_requires_serial_pairing(p_job_id text, p_company_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "jobUnitPairing" p
    WHERE p."companyId" = p_company_id AND p."jobId" = p_job_id
  ) OR EXISTS (
    SELECT 1
    FROM "companySettings" cs
    JOIN job j ON j."companyId" = cs.id
    JOIN item sales ON sales.id = j."itemId" AND sales."companyId" = j."companyId"
    JOIN "jobMakeMethod" mm ON mm."jobId" = j.id AND mm."companyId" = j."companyId"
      AND mm."parentMaterialId" IS NULL AND mm."itemId" = sales.id
    WHERE cs.id = p_company_id AND cs."serialNumberFromComponent"
      AND j."createdAt" >= cs."serialNumberFromComponentEnabledAt"
      AND j.id = p_job_id AND sales."itemTrackingType" = 'Serial' AND mm."requiresSerialTracking"
      AND j."fixedAssetClassId" IS NULL AND j."fixedAssetId" IS NULL
      AND NOT COALESCE(j."consumeToProject", false)
      AND NOT EXISTS (
        SELECT 1 FROM "itemSerialSequence" seq
        WHERE seq."companyId" = j."companyId" AND seq."itemId" = sales.id
      )
      AND EXISTS (
        SELECT 1
        FROM "jobMaterial" m
        JOIN item source ON source.id = m."itemId" AND source."companyId" = m."companyId"
        WHERE m."companyId" = j."companyId" AND m."jobId" = j.id
          AND m."jobMakeMethodId" = mm.id AND m.quantity > 0
          AND (m."requiresSerialTracking" OR source."itemTrackingType" = 'Serial')
        HAVING count(*) = 1 AND bool_and(
          m.quantity = 1 AND m."requiresSerialTracking" AND m."methodType" = 'Pull from Inventory'
          AND source."itemTrackingType" = 'Serial' AND source.id <> sales.id
        )
      )
  );
$$;

NOTIFY pgrst, 'reload schema';
RESET lock_timeout;
