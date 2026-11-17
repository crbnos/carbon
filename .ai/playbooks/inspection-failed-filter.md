# Receipts sidebar: Inspection failed filter

Last tested: 2026-11-17
Routes: /x/inventory/receipts (sidebar links), /x/purchase-order/<id>/details,
/x/receipt/<id>/details, /x/inspection/<lotId>, /x/stock-transfer/<id>

## Prerequisites
- Seeded Carbon Development company. PO000020 is "To Receive and Invoice" with
  PCB-BARE-REV3 × 25 (untracked, Receipt inspection plan with 2 characteristics,
  2 samples) and BAT-LIION-48V × 25 (batch).
- Manufacturing Plant has an inspection storage unit (QC-Inspection).

## Steps
### 1. Make one receipt per case
For each receipt: PO000020 details → button "Receipts" → menuitem "New Receipt".
1. Fill "Received quantity for BAT-LIION-48V" with 0. Blur on "External Reference".
2. Fill "Received quantity for PCB-BARE-REV3" with 5. Blur.
3. Click "Post". requestSubmit the "Post Receipt" button.
4. Click "Acknowledge & continue" (a seeded storage rule warns).

Decide each lot on `/x/inspection/<lotId>` (`inspection.sourceDocumentId` = receipt id):

| Case | Decision | Receipt status |
|---|---|---|
| Partial | "Partial" → Accepted quantity 3 → requestSubmit "Mark Partial" | Partially Passed |
| All failed | "Reject Lot" → Reason → requestSubmit "Reject Lot" in the dialog | Inspection Failed |
| All passed | Enter 4 readings (1.6, 1.6, 1.0, 1.0) → "Accept Lot" → requestSubmit "Accept Lot" in the dialog | Inspection Passed |
| Mixed | Split the PCB line (see notes) → post → accept lot 1, reject lot 2 | Partially Passed |
| Pending | Post only | Pending Inspection |

### 2. Check the sidebar links

| Link | Lists |
|---|---|
| Inspection failed | `rejectedAtInspection:eq:true`: any receipt with a Failed or Partial lot |
| Ready for putaway | Inspection Passed, Partially Passed |
| Pending inspection | Pending Inspection, Inspection In Progress |

- The Inspection failed chip reads "Rejected at Inspection is Yes". The column
  of that name is hidden by default.

### 3. Partial receipt after putaway
- Partial receipt → "Put Away" → "Pick" on the transfer line. The receipt reads
  "Put Away", leaves Ready for putaway, and stays in Inspection failed.

## Selector Notes
- Use `agent-browser --session <name>`: other agents share the default session.
- Reading cells: `td[data-row=<characteristic>][data-column=<2|3>] [data-entry-cell]`.
  Click the cell, `press` each character, then `press Enter`.
- "Split receipt line" in the line ⋯ menu did not open its modal under
  agent-browser. POST FormData (`documentId`, `documentLineId`, `locationId`,
  `quantity`) to `/x/receipt/lines/split` with `fetch` from the page instead.

## Common Failures
- `erp.<slug>.dev` answers "No app registered" while `~/.portless/routes.json`
  lists it: the shared portless proxy stopped reloading its routes. Without
  restarting it, run a second ERP dev server with `DOMAIN=` (host-only cookies),
  `SUPABASE_URL=http://127.0.0.1:<PORT_API>` and `--port 4526`, and log in at
  `http://127.0.0.1:4526/login`.
- "Sign-ups are disabled" at login: the server cannot reach GoTrue through the
  proxy. Same workaround.
