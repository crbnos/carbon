ALTER TABLE "contact"
ADD CONSTRAINT "contact_email_companyId_unique" UNIQUE ("email", "companyId");