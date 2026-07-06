-- Passkey (WebAuthn) credential storage

CREATE TABLE "passkeyCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "deviceType" TEXT CHECK ("deviceType" IN ('singleDevice', 'multiDevice')) NOT NULL,
  "backedUp" BOOLEAN NOT NULL DEFAULT false,
  "transports" TEXT[],
  "aaguid" TEXT NOT NULL DEFAULT '',
  "rpId" TEXT NOT NULL,
  "userHandle" TEXT,  
  "credentialName" TEXT NOT NULL DEFAULT 'Passkey',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "lastUsedAt" TIMESTAMPTZ,
  CONSTRAINT "passkeyCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "passkeyCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "passkeyCredential_userId_idx" ON "passkeyCredential" ("userId");

ALTER TABLE "passkeyCredential" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "passkeyCredential"
FOR SELECT USING (auth.uid()::text = "userId"::text);


CREATE POLICY "INSERT" ON "passkeyCredential"
FOR INSERT WITH CHECK (auth.uid()::text = "userId"::text);


CREATE POLICY "DELETE" ON "passkeyCredential"
FOR DELETE USING (auth.uid()::text = "userId"::text);

CREATE POLICY "UPDATE" ON "passkeyCredential"
FOR UPDATE USING (auth.uid()::text = "userId"::text);