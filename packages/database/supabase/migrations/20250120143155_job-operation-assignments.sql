ALTER TABLE "jobOperation" ADD COLUMN "assignee" TEXT REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "jobOperation" ADD COLUMN "tags" TEXT[] DEFAULT '{}';