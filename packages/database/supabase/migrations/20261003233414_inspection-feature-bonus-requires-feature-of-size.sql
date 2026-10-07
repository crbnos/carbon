-- An MMC/LMC characteristic earns its bonus from a feature of size, and the
-- bonus has no direction without knowing whether that feature is Internal or
-- External. The save validators checked this on each payload, but an update
-- payload is partial: it could clear "featureOfSize" on a stored MMC row, or be
-- refused for omitting a value the row already has. The rule belongs on the
-- stored row, so every writer (the plan editor's RPC, the API) is held to it.
ALTER TABLE "inspectionFeature"
  ADD CONSTRAINT "inspectionFeature_bonus_requires_feature_of_size"
  CHECK (
    "materialCondition" IS NULL
    OR "materialCondition" = 'RFS'
    OR "featureOfSize" IS NOT NULL
  );
