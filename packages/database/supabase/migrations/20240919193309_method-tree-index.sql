-- Add indexes to improve performance
CREATE INDEX IF NOT EXISTS "idx_makeMethod_itemId" ON "makeMethod" ("itemId");
CREATE INDEX IF NOT EXISTS "idx_methodMaterial_makeMethodId" ON "methodMaterial" ("makeMethodId");
CREATE INDEX IF NOT EXISTS "idx_methodOperation_makeMethodId" ON "methodOperation" ("makeMethodId");


CREATE INDEX IF NOT EXISTS "idx_quoteMaterial_quoteMakeMethodId" ON "quoteMaterial" ("quoteMakeMethodId");
CREATE INDEX IF NOT EXISTS "idx_quoteOperation_quoteMakeMethodId" ON "quoteOperation" ("quoteMakeMethodId");
CREATE INDEX IF NOT EXISTS "idx_quoteMakeMethod_itemId" ON "quoteMakeMethod" ("itemId");
CREATE INDEX IF NOT EXISTS "idx_quoteMakeMethod_quoteId" ON "quoteMakeMethod" ("quoteId");
CREATE INDEX IF NOT EXISTS "idx_quoteMakeMethod_quoteLineId" ON "quoteMakeMethod" ("quoteLineId");
CREATE INDEX IF NOT EXISTS "idx_quoteMakeMethod_parentMaterialId" ON "quoteMakeMethod" ("parentMaterialId");


CREATE INDEX IF NOT EXISTS "idx_jobMaterial_jobMakeMethodId" ON "jobMaterial" ("jobMakeMethodId");
CREATE INDEX IF NOT EXISTS "idx_jobOperation_jobMakeMethodId" ON "jobOperation" ("jobMakeMethodId");
CREATE INDEX IF NOT EXISTS "idx_jobMakeMethod_itemId" ON "jobMakeMethod" ("itemId");
CREATE INDEX IF NOT EXISTS "idx_jobMakeMethod_jobId" ON "jobMakeMethod" ("jobId");
CREATE INDEX IF NOT EXISTS "idx_jobMakeMethod_parentMaterialId" ON "jobMakeMethod" ("parentMaterialId");
