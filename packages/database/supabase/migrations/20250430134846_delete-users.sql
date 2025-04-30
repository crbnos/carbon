-- Modify the feedback table to allow userId to be null
ALTER TABLE "feedback" ALTER COLUMN "userId" DROP NOT NULL;

-- Drop the existing foreign key constraint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_userId_fkey";

-- Add a new foreign key constraint with ON DELETE SET NULL
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL;
