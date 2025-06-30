-- Add unique constraint to lessonCompletion to prevent duplicate completions
ALTER TABLE "lessonCompletion"
ADD CONSTRAINT "unique_lesson_completion" UNIQUE ("userId", "courseId", "lessonId");

-- Add unique constraint to challengeAttempt to prevent multiple passed attempts
CREATE UNIQUE INDEX "unique_passed_challenge" ON "challengeAttempt" ("userId", "courseId", "topicId") 
WHERE passed = true;
