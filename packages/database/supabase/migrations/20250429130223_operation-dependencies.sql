-- Create a dedicated table for operation dependencies
CREATE TABLE "jobOperationDependency" (
  "operationId" TEXT NOT NULL,
  "dependsOnId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "jobOperationDependency_pk" PRIMARY KEY ("operationId", "dependsOnId"),
  CONSTRAINT "jobOperationDependency_operationId_fk" FOREIGN KEY ("operationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationDependency_dependsOnId_fk" FOREIGN KEY ("dependsOnId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationDependency_jobId_fk" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "jobOperationDependency_companyId_fk" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,

  CONSTRAINT "jobOperationDependency_no_self_dependency" CHECK ("operationId" != "dependsOnId")
);


-- Create an index to improve query performance on the dependency table
CREATE INDEX "idx_jobOperationDependency_operationId" ON "jobOperationDependency" ("operationId");
CREATE INDEX "idx_jobOperationDependency_jobId" ON "jobOperationDependency" ("jobId");
