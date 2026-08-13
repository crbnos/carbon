-- ITAR certification system.
--
-- Replaces the single global `user.acknowledgedITAR` boolean with a real,
-- per-company certification record: entity (company Rider acceptance) and user
-- (U.S.-Person attestation) certs, each carrying the accepted Rider version +
-- hash, the signer's details, IP/user-agent, and a 365-day expiry. The app gate
-- becomes "a valid unexpired row exists" instead of a boolean flip.
--
-- The `user.acknowledgedITAR` column is intentionally left in place — Brad drops
-- it in a follow-up once the new gate is confirmed in the controlled environment.

CREATE TABLE "itarCertification" (
    "id" TEXT NOT NULL DEFAULT id('itc'),
    "companyId" TEXT NOT NULL,

    -- 'entity' = a representative binding the company to the Carbon GovCloud
    -- Rider; 'user' = an individual's U.S.-Person attestation. For an entity
    -- cert, "userId" is the admin who accepted on the company's behalf.
    "type" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    "docVersion" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "fullLegalName" TEXT NOT NULL,
    "title" TEXT,                 -- entity only
    "complianceContact" TEXT,     -- entity only

    "certifiedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,  -- certifiedAt + 365 days, set by the app

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "itarCertification_type_check" CHECK ("type" IN ('user', 'entity')),

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("userId") REFERENCES "user"("id")
);

CREATE INDEX "itarCertification_companyId_idx" ON "itarCertification" ("companyId");
CREATE INDEX "itarCertification_userId_idx" ON "itarCertification" ("userId");
CREATE INDEX "itarCertification_createdBy_idx" ON "itarCertification" ("createdBy");
-- The gate reads "latest valid unexpired row" per company/user/type.
CREATE INDEX "itarCertification_gate_idx"
    ON "itarCertification" ("companyId", "type", "userId", "expiresAt");

ALTER TABLE "public"."itarCertification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itarCertification"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- No client INSERT/UPDATE/DELETE policies by design: certifications are a
-- compliance record written ONLY server-side via the service-role client
-- (recordCertification / recordItarCertification), which sets the authoritative
-- Rider docVersion/docHash, server-captured ipAddress/userAgent, and the 365-day
-- expiry. RLS is enabled, so with no write policy the supabase-js path is denied
-- outright — a caller holding settings_create/update/delete cannot insert forged
-- fields, or alter/delete existing certification evidence. Read stays open to any
-- employee via the SELECT policy above (the compliance report needs it).

-- Invite attestation: when CONTROLLED_ENVIRONMENT is on, an admin inviting an
-- employee must attest a reasonable basis that the invitee is a U.S. person
-- (22 CFR 120.62). Recorded as who attested and when.
ALTER TABLE "invite" ADD COLUMN "attestedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "invite" ADD COLUMN "attestedAt" TIMESTAMP WITH TIME ZONE;

-- Attach async event triggers so itarCertification + invite changes flow to the
-- AUDIT handler. The AUDIT eventSystemSubscription rows are created at runtime by
-- syncAuditSubscriptions, so no subscription SQL is needed here. Pass all three
-- args explicitly — a 2-arg call is ambiguous (legacy 2-arg vs 3-arg overload).
SELECT attach_event_trigger('itarCertification'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
SELECT attach_event_trigger('invite'::text, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
