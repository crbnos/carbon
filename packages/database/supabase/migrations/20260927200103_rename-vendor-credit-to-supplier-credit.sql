-- Vendor credits are supplier credits.
--
-- Carbon says "supplier"; only third-party integrations say "vendor". The AP
-- memo entity was the exception: the accounting-sync engine keyed it
-- `vendorCredit` in four places that are PERSISTED DATA, not just code. The
-- application rename lands in the same change; this migration moves the stored
-- values so the two stay in step.
--
-- Nothing is renamed in a provider's own vocabulary: Rillet still posts to
-- `/vendor-credits` and QuickBooks still calls the object a `VendorCredit`.
-- Only Carbon's key changes.
--
-- Same shape as 20260922195151_rename-card-transactions-to-charges.sql, which
-- rewrote `externalIntegrationMapping.entityType` for cardTransaction → charge.
-- Every statement is naturally idempotent: the WHERE clauses match nothing on a
-- second run, which is what the retryable deploy runner needs.
--
-- Both `entityType` columns are plain TEXT (no enum, no check constraint), so
-- there is no type to alter. The unique indexes over them
-- (externalIntegrationMapping_entityType_entityId_integration_comp,
-- accountingSyncOperation_live_uq, accountingSyncOperation_idempotency_uq)
-- cannot collide here: no 'supplierCredit' row can exist before this runs.

-- 1. The push identity. This one is load-bearing: the syncer looks up the
--    mapping by (entityType, entityId) to decide create-vs-update, so a missed
--    row would be re-pushed as a NEW credit in the customer's ledger.
UPDATE "externalIntegrationMapping"
SET "entityType" = 'supplierCredit'
WHERE "entityType" = 'vendorCredit';

-- 2. The sync ledger. `idempotencyKey` is built as
--    `${entityType}:${entityId}:${direction}:${scope}`
--    (getSyncOperationIdempotencyKey), so its prefix has to move WITH the
--    column — otherwise a re-enqueue computes a different key and duplicates
--    the row. A Pending / In Flight row left on the old type would also never
--    be claimed again, because the drain filters by entityType.
UPDATE "accountingSyncOperation"
SET
  "entityType" = 'supplierCredit',
  "idempotencyKey" = CASE
    WHEN "idempotencyKey" LIKE 'vendorCredit:%'
      THEN 'supplierCredit' || substring("idempotencyKey" FROM length('vendorCredit') + 1)
    ELSE "idempotencyKey"
  END
WHERE "entityType" = 'vendorCredit';

-- `companyIntegration.metadata` is `json`, NOT `jsonb` — `jsonb_set` and the
-- `#-` delete operator do not exist for `json`, so both statements below cast
-- to jsonb for the edit and back to json for the store. Casting the WHERE too
-- keeps the guard and the edit reading the same value.

-- 3. The per-entity sync config (SyncConfigSchema.entities). Stored at
--    companyIntegration.metadata.syncConfig.entities.
UPDATE "companyIntegration"
SET metadata = jsonb_set(
  (metadata::jsonb) #- '{syncConfig,entities,vendorCredit}',
  '{syncConfig,entities,supplierCredit}',
  (metadata::jsonb) #> '{syncConfig,entities,vendorCredit}'
)::json
WHERE (metadata::jsonb) #> '{syncConfig,entities,vendorCredit}' IS NOT NULL;

-- 4. The posting-sync family mode (PostingSyncStoredSchema.families). Stored at
--    companyIntegration.metadata.settings.postingSync.families.
--
--    This key defaults to "none", so a missed row does not fail loudly — it
--    silently STOPS pushing supplier credits for a company that had turned them
--    on. `normalizeStoredPostingSyncSettings` carries a read-side alias for the
--    same key as belt-and-braces during the deploy window.
UPDATE "companyIntegration"
SET metadata = jsonb_set(
  (metadata::jsonb) #- '{settings,postingSync,families,vendorCredit}',
  '{settings,postingSync,families,supplierCredit}',
  (metadata::jsonb) #> '{settings,postingSync,families,vendorCredit}'
)::json
WHERE (metadata::jsonb) #> '{settings,postingSync,families,vendorCredit}' IS NOT NULL;
