-- agentThread: one row per conversation, owned by a user within a company
CREATE TABLE "agentThread" (
    "id" TEXT NOT NULL DEFAULT id('agt'),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id"),
    "title" TEXT,
    "modelId" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    "lastContext" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "agentThread_companyId_userId_idx" ON "agentThread" ("companyId", "userId", "createdAt" DESC);
CREATE INDEX "agentThread_createdBy_idx" ON "agentThread" ("createdBy");

ALTER TABLE "public"."agentThread" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."agentThread" FOR SELECT USING (
  "userId" = auth.uid()::text
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."agentThread" FOR INSERT WITH CHECK (
  "userId" = auth.uid()::text
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "UPDATE" ON "public"."agentThread" FOR UPDATE USING (
  "userId" = auth.uid()::text
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "DELETE" ON "public"."agentThread" FOR DELETE USING (
  "userId" = auth.uid()::text
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- agentMessage: one row per message
CREATE TABLE "agentMessage" (
    "id" TEXT NOT NULL DEFAULT id('agm'),
    "threadId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" TEXT NOT NULL CHECK ("role" IN ('user','assistant','system')),
    "context" JSONB,
    "feedback" TEXT CHECK ("feedback" IN ('up','down')),
    "feedbackNote" TEXT,
    "finishReason" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("threadId", "companyId") REFERENCES "agentThread"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "agentMessage_threadId_idx" ON "agentMessage" ("threadId", "createdAt");
CREATE INDEX "agentMessage_createdBy_idx" ON "agentMessage" ("createdBy");

ALTER TABLE "public"."agentMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."agentMessage" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND EXISTS (SELECT 1 FROM "public"."agentThread" t
              WHERE t."id" = "agentMessage"."threadId" AND t."companyId" = "agentMessage"."companyId"
              AND t."userId" = auth.uid()::text)
);
CREATE POLICY "INSERT" ON "public"."agentMessage" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND EXISTS (SELECT 1 FROM "public"."agentThread" t
              WHERE t."id" = "agentMessage"."threadId" AND t."companyId" = "agentMessage"."companyId"
              AND t."userId" = auth.uid()::text)
);
CREATE POLICY "UPDATE" ON "public"."agentMessage" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND EXISTS (SELECT 1 FROM "public"."agentThread" t
              WHERE t."id" = "agentMessage"."threadId" AND t."companyId" = "agentMessage"."companyId"
              AND t."userId" = auth.uid()::text)
);

-- agentMessagePart: ordered polymorphic content blocks (text / reasoning / tool / error)
CREATE TABLE "agentMessagePart" (
    "id" TEXT NOT NULL DEFAULT id('agp'),
    "messageId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL CHECK ("type" IN ('text','reasoning','tool','error')),
    "textContent" TEXT,
    "toolName" TEXT,
    "toolClassification" TEXT CHECK ("toolClassification" IN ('READ','WRITE','DESTRUCTIVE','DOCS')),
    "toolCallId" TEXT,
    "toolInput" JSONB,
    "toolOutput" JSONB,
    "toolState" TEXT CHECK ("toolState" IN
      ('pending','running','success','error','awaiting_confirmation','rejected')),
    "toolDurationMs" INTEGER,
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("messageId", "companyId") REFERENCES "agentMessage"("id", "companyId") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "agentMessagePart_order_idx" ON "agentMessagePart" ("messageId", "orderIndex");
CREATE INDEX "agentMessagePart_createdBy_idx" ON "agentMessagePart" ("createdBy");

ALTER TABLE "public"."agentMessagePart" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."agentMessagePart" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND EXISTS (SELECT 1 FROM "public"."agentMessage" m JOIN "public"."agentThread" t
              ON t."id" = m."threadId" AND t."companyId" = m."companyId"
              WHERE m."id" = "agentMessagePart"."messageId" AND m."companyId" = "agentMessagePart"."companyId"
              AND t."userId" = auth.uid()::text)
);
CREATE POLICY "INSERT" ON "public"."agentMessagePart" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND EXISTS (SELECT 1 FROM "public"."agentMessage" m JOIN "public"."agentThread" t
              ON t."id" = m."threadId" AND t."companyId" = m."companyId"
              WHERE m."id" = "agentMessagePart"."messageId" AND m."companyId" = "agentMessagePart"."companyId"
              AND t."userId" = auth.uid()::text)
);
CREATE POLICY "UPDATE" ON "public"."agentMessagePart" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND EXISTS (SELECT 1 FROM "public"."agentMessage" m JOIN "public"."agentThread" t
              ON t."id" = m."threadId" AND t."companyId" = m."companyId"
              WHERE m."id" = "agentMessagePart"."messageId" AND m."companyId" = "agentMessagePart"."companyId"
              AND t."userId" = auth.uid()::text)
);
