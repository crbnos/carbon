-- Contact email is not unique. 20260112120041 meant to drop the index, but it
-- named it unquoted, Postgres folded the name to lower case and `IF EXISTS`
-- found nothing, so a second contact with one email was still refused.
SET lock_timeout = '5s';
DROP INDEX IF EXISTS "contact_email_companyId_unique_idx";
RESET lock_timeout;

-- A contact belongs to a customer or supplier through its link rows. Deleting
-- the customer or supplier removed the links but left the contact behind,
-- invisible in the app. sync_delete_unlinked_contact now removes it with its
-- last link; this removes the ones already left. Under app.sync_in_progress,
-- so no webhook, workflow or audit event is queued for contacts nobody saw.
DO $$
BEGIN
  PERFORM set_config('app.sync_in_progress', 'true', true);
  DELETE FROM "contact" c
  WHERE NOT EXISTS (SELECT 1 FROM "customerContact" cc WHERE cc."contactId" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "supplierContact" sc WHERE sc."contactId" = c."id");
END $$;
