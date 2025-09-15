ALTER TYPE "procedureStepType" ADD VALUE 'Task';

ALTER TABLE "procedureStep" DROP COLUMN "description";
ALTER TABLE "jobOperationAttribute" DROP COLUMN "description";
ALTER TABLE "quoteOperationAttribute" DROP COLUMN "description";
ALTER TABLE "methodOperationAttribute" DROP COLUMN "description";

ALTER TABLE "procedureStep" ADD COLUMN "description" JSON DEFAULT '{}';
ALTER TABLE "jobOperationAttribute" ADD COLUMN "description" JSON DEFAULT '{}';
ALTER TABLE "quoteOperationAttribute" ADD COLUMN "description" JSON DEFAULT '{}';
ALTER TABLE "methodOperationAttribute" ADD COLUMN "description" JSON DEFAULT '{}';
