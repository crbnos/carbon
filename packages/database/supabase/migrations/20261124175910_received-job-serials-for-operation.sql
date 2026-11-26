-- A posted stock or asset receipt can identify a serial even when the
-- operation has no production marker. A legacy bulk seed receipt cannot.
CREATE OR REPLACE VIEW public."jobReceivedSerial" WITH (security_invoker = true) AS
SELECT j.id AS "jobId", j."companyId", unit.id AS "trackedEntityId"
FROM public.job j
CROSS JOIN LATERAL util.received_job_serials(j.id, j."companyId") AS received(id)
JOIN public."trackedEntity" unit ON unit.id = received.id AND unit."companyId" = j."companyId"
WHERE j."quantityReceivedToInventory" > 0 AND unit.quantity = 1
  AND NOT EXISTS (
    SELECT 1 FROM public."itemLedger" il
    WHERE il."companyId" = j."companyId" AND il."documentId" = j.id
      AND il."documentType" = 'Job Receipt' AND il."trackedEntityId" = unit.id
    HAVING sum(il.quantity) > 1
  );
