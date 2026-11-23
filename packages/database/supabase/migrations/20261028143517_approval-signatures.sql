-- Approval signatures. Spec: .ai/specs/2026-10-28-approval-signatures.md
--
-- A user keeps one signature image at `user.signaturePath`, a key in the
-- private `signatures` bucket under their own `{userId}/` folder. Approving a
-- request copies that key to `approvalRequest.decisionSignaturePath`, so a
-- later change of signature never changes an approved document. Files are
-- never overwritten (no UPDATE policy) and only the server deletes them, after
-- checking that no approval names the file.

INSERT INTO storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES ('signatures', 'signatures', false, 1048576, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT ("id") DO NOTHING;

CREATE POLICY "Users can view their own signatures" ON storage.objects
FOR SELECT USING (
  bucket_id = 'signatures'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
);

CREATE POLICY "Users can upload their own signatures" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'signatures'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
);

ALTER TABLE "user" ADD COLUMN "signaturePath" TEXT;

ALTER TABLE "approvalRequest" ADD COLUMN "decisionSignaturePath" TEXT;

ALTER TABLE "companySettings"
  ADD COLUMN "requirePurchaseOrderApprovalSignature" BOOLEAN NOT NULL DEFAULT false;
