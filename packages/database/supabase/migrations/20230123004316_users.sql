CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT GENERATED ALWAYS AS ("firstName" || ' ' || "lastName") STORED,
    "about" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "active" BOOLEAN DEFAULT TRUE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "index_user_email_key" ON "user"("email");
CREATE INDEX "index_user_fullName" ON "user"("fullName");
