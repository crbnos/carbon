-- Create table for mapping non-conformances to Slack threads
CREATE TABLE "nonConformanceSlackThread" (
  "id" TEXT NOT NULL DEFAULT id('ncslt'),
  "nonConformanceId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "threadTs" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceSlackThread_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceSlackThread_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSlackThread_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSlackThread_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSlackThread_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceSlackThread_unique" UNIQUE ("nonConformanceId", "companyId")
);

-- Create indexes for efficient lookups
CREATE INDEX "nonConformanceSlackThread_nonConformanceId_idx" ON "nonConformanceSlackThread" ("nonConformanceId");
CREATE INDEX "nonConformanceSlackThread_companyId_idx" ON "nonConformanceSlackThread" ("companyId");
CREATE INDEX "nonConformanceSlackThread_channelId_threadTs_idx" ON "nonConformanceSlackThread" ("channelId", "threadTs");

-- Enable Row Level Security
ALTER TABLE "nonConformanceSlackThread" ENABLE ROW LEVEL SECURITY;

-- RLS Policies using modern pattern
CREATE POLICY "SELECT" ON "public"."nonConformanceSlackThread"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceSlackThread"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceSlackThread"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceSlackThread"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('quality_delete'))::text[]
  )
);

-- Add Slack configuration to integration metadata
-- Update the Slack integration jsonschema to include non-conformance settings
UPDATE "integration"
SET "jsonschema" = jsonb_build_object(
  'type', 'object',
  'properties', jsonb_build_object(
    'access_token', jsonb_build_object('type', 'string'),
    'team_id', jsonb_build_object('type', 'string'),
    'team_name', jsonb_build_object('type', 'string'),
    'channel', jsonb_build_object('type', 'string'),
    'channel_id', jsonb_build_object('type', 'string'),
    'slack_configuration_url', jsonb_build_object('type', 'string'),
    'url', jsonb_build_object('type', 'string'),
    'bot_user_id', jsonb_build_object('type', 'string'),
    'nonconformance_channel_id', jsonb_build_object(
      'type', 'string',
      'description', 'Default Slack channel for non-conformance notifications'
    ),
    'nonconformance_notifications_enabled', jsonb_build_object(
      'type', 'boolean',
      'default', true,
      'description', 'Enable automatic Slack notifications for non-conformances'
    )
  )
)
WHERE "id" = 'slack';