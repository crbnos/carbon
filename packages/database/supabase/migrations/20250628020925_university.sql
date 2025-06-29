CREATE TABLE "lessonCompletion" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY ("userId", "courseId", "lessonId"),
    FOREIGN KEY ("userId") REFERENCES "user"("id")
);


CREATE INDEX "lessonCompletion_userId_courseId_lessonId_idx" ON "lessonCompletion" ("userId", "courseId", "lessonId");
CREATE INDEX "lessonCompletion_courseId_idx" ON "lessonCompletion" ("courseId");

ALTER TABLE "lessonCompletion" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "lessonCompletion"
    FOR SELECT USING (auth.uid()::text = "userId");

CREATE POLICY "INSERT" ON "lessonCompletion"
    FOR INSERT WITH CHECK (auth.uid()::text = "userId");


CREATE TABLE "challengeAttempt" (
    "id" SERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT FALSE,
    "topicId" TEXT NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    
    FOREIGN KEY ("userId") REFERENCES "user"("id")
);

CREATE INDEX "challengeAttempt_userId_courseId_topicId_idx" ON "challengeAttempt" ("userId", "courseId", "topicId");
CREATE INDEX "challengeAttempt_courseId_idx" ON "challengeAttempt" ("courseId");

ALTER TABLE "challengeAttempt" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "challengeAttempt"
    FOR SELECT USING (auth.uid()::text = "userId");

CREATE POLICY "INSERT" ON "challengeAttempt"
    FOR INSERT WITH CHECK (auth.uid()::text = "userId");