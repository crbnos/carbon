ALTER TYPE "procedureAttributeType" ADD VALUE 'Task';

ALTER TABLE "procedureAttribute" DROP COLUMN "description";
ALTER TABLE "jobOperationAttribute" DROP COLUMN "description";
ALTER TABLE "quoteOperationAttribute" DROP COLUMN "description";
ALTER TABLE "methodOperationAttribute" DROP COLUMN "description";

ALTER TABLE "procedureAttribute" ADD COLUMN "description" JSON DEFAULT '{}';
ALTER TABLE "jobOperationAttribute" ADD COLUMN "description" JSON DEFAULT '{}';
ALTER TABLE "quoteOperationAttribute" ADD COLUMN "description" JSON DEFAULT '{}';
ALTER TABLE "methodOperationAttribute" ADD COLUMN "description" JSON DEFAULT '{}';
