# Approval signatures — implementation plan

Spec: `.ai/specs/2026-10-28-approval-signatures.md`. Branch `feat/user-signatures`.

Sibling: the profile photo (`ProfilePhotoForm`, `updateOwnAvatar`, the `photo`
intent of `api+/account.profile.ts`).

## Tasks

- [x] 1. Migration `20261028143517_approval-signatures.sql`: private
      `signatures` bucket (1 MB, PNG/JPEG), owner SELECT/INSERT policies,
      `user.signaturePath`, `approvalRequest.decisionSignaturePath`,
      `companySettings.requirePurchaseOrderApprovalSignature`.
      Verify: user runs `pnpm db:migrate` (regenerates types).
- [x] 2. `@carbon/utils`: `isOwnSignaturePath(userId, path)` — the one check
      that a path sits in the user's own folder. Used by the server write,
      the approval snapshot and the PDF read, so a path a user wrote into
      their own row through the API cannot point at someone else's file.
- [x] 3. ee `approveRequest`: read the approver's `signaturePath`; for a
      purchase order with the company setting on and no own signature,
      return `{ code: "signature-required" }` and write nothing; else write
      `decisionSignaturePath`. `getDocumentApproval` returns `signaturePath`.
- [x] 4. ERP users: `updateOwnSignature({ path | null })` operation (path must
      pass task 2); deletes the replaced file with the service role unless an
      `approvalRequest` names it. `account.profile.ts`: `signature` intent,
      loader returns `signatureUrl` (signed, 5 min). `AccountProfileData`
      gains `signatureUrl`.
- [x] 5. `@carbon/account` UI: `SignatureForm` (preview on white, Draw modal
      with a plain canvas, Upload through `prepareImageUpload({ height: 200 })`,
      Remove) under the photo in `ProfileSettings`.
- [x] 6. Purchasing: `getPurchaseOrderApproval` downloads the file (service
      role, path re-checked against `decisionBy`) and returns a data URL;
      `decidePurchaseOrderApproval` maps `signature-required` to `validation`.
      PO page: Approve opens "Add your signature" when the setting is on and
      the user has none.
- [x] 7. Settings → Purchasing: toggle `requirePurchaseOrderApprovalSignature`.
- [x] 8. Documents: built-in block `approval` (schema, `BLOCK_META` with
      `showWhenAppended`, default PO layout after Terms, `resolveTemplate`
      appends it visible), `ApprovalBlock` in the PO registry, other full
      registries return null, sample signature.
- [x] 9. Verify: license headers, Biome, typecheck `@carbon/utils`,
      `@carbon/documents`, `@carbon/ee`, `@carbon/account`, `erp` (one at a
      time), documents tests, `lingui:extract`. Update rule
      `document-template-customizer.md` and the purchasing AGENTS.md.

## Status

- Done: every task. Typecheck passes for `@carbon/utils`, `@carbon/account`
  and `@carbon/documents`. Tests pass for `signature.test.ts` and
  `template.test.ts`. Biome is clean.
- Open: the user runs `pnpm db:migrate`. Then typecheck `@carbon/ee` and
  `erp` again. Their only errors today are the three new columns.
- Open: fill the 22 new strings per catalog with `/translate` before the commit.
