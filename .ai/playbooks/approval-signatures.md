# Approval Signatures (profile signature, PO approval, PO PDF)

Last tested: 2026-10-28
Routes: `/x?account=profile`, `/x/settings/purchasing`, `/x/purchase-order/<id>/details`, `/file/purchase-order/<id>.pdf`

## Prerequisites
- Logged in via `/auth` (test@carbon.ms). Migration `20261028143517_approval-signatures` applied.
- A PO approval rule whose approver is the test user (the seeded demo company has two: ≥ 5,000 and ≥ 25,000).
- A Draft or Planned PO above the rule's amount (demo: PO000004, Planned, 28,700).

## Steps
### 1. Add a signature
- Open `/x?account=profile`. Section "Signature": empty state is a dashed button "Add your signature"; saved state shows the image with "Change" / "Remove".
- The dialog "Your signature" has tabs Draw / Upload.
- Draw: read the canvas rect (`document.querySelector('canvas').getBoundingClientRect()`), then `agent-browser mouse move/down/move…/up` across it. Undo is ⌘Z or the corner icon. "Save signature" enables once there is ink.
- Upload: `agent-browser upload 'input[type=file][accept="image/png,image/jpeg"]' <png>`; a preview shows; then "Save signature".
- Verify: toast "Saved signature"; `fetch('/api/account/profile')` → `user.signaturePath` = `<userId>/<uuid>.png`, `signatureUrl` set.
### 2. Require a signature
- `/x/settings/purchasing` → card "Require a Signature to Approve Purchase Orders" → click its switch (the second switch on the page). Toast "Approval signature requirement enabled".
### 3. Finalize the PO
- PO page → "Finalize" → dialog: open "Send Via" and pick option "None" (Clear leaves it empty and fails validation) → requestSubmit the form whose submit button starts with "Finalize". PO becomes Needs Approval.
### 4. Approve without a signature
- Remove the signature first. "Approve" opens dialog "Add your signature" instead of the approval dialog.
- Direct POST is refused too: `fetch('/x/purchase-order/<id>.data?_routes=' + encodeURIComponent('routes/x+/purchase-order+/$orderId'), { method: 'POST', body: FormData{approvalRequestId, decision: 'Approved', notification: 'None'} })` → PO stays Needs Approval.
### 5. Approve with a signature and check the PDF
- Add a signature, "Approve" → "Send Via" None → requestSubmit "Approve". `approvalRequest.decisionSignaturePath` = the file.
- Download the PDF in the page (`fetch` → base64), then `pdftotext -layout` shows "APPROVED BY", the name and date; `pdfimages -list` shows one image + smask.
### 6. Snapshot kept
- Change the signature. The old file stays in `storage.objects` (an approval names it); the PO PDF still embeds the old image (same size in `pdfimages -list`).

## Selector Notes
- Tabs: `agent-browser find role tab click --name "Upload"`.
- Avatar picker: "Choose avatar"; swatches are `[role=radio]` with `aria-label="#<hex>"`; style tiles are `[role=radio]` with the style name as text.

## Common Failures
- `agent-browser` "Executable doesn't exist": set `AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` and use `--session <name>`.
- An open modal does not pick up HMR changes: reopen it.
