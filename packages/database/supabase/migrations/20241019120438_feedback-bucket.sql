INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('feedback', 'feedback', true), 

CREATE POLICY "Anyone can read the feedback buckets"
ON storage.objects FOR SELECT USING (
    bucket_id = 'feedback'
    AND (auth.role() = 'authenticated')
);

CREATE POLICY "Anyone with settings_create can insert into the feedback bucket"
ON storage.objects FOR INSERT WITH CHECK (
    bucket_id = 'feedback'
    AND (auth.role() = 'authenticated')
);


CREATE TABLE "feedback" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "location" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "feedback" TEXT NOT NULL,
  "attachmentPath" TEXT,

  CONSTRAINT "feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id")
);

ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
