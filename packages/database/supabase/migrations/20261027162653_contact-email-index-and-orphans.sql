-- Contact email is not unique. 20260112120041 meant to drop the index, but it
-- named it unquoted, Postgres folded the name to lower case and `IF EXISTS`
-- found nothing, so a second contact with one email was still refused.
DROP INDEX IF EXISTS "contact_email_companyId_unique_idx";

-- A contact belongs to one customer or supplier. Deleting the customer or
-- supplier removed the link row but left the contact behind, invisible in the
-- app. sync_delete_unlinked_contact now removes it with its last link; this
-- removes the ones already left.
DELETE FROM "contact" c
WHERE NOT EXISTS (SELECT 1 FROM "customerContact" cc WHERE cc."contactId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "supplierContact" sc WHERE sc."contactId" = c."id");
