# Payments, refunds, PO guards and close warnings

Last tested: 2026-11-06
Routes: /x/payments/new, /x/payments/<id>, /x/purchase-order/<id>/details, /x/accounting/periods/<id>/close

## Prerequisites
- Isolated migrated database, standard demo company and test@carbon.ms user.
- ERP and auth/REST API only; one browser tab. Realtime and Storage were not started.
- Limit ERP heap to 2048 MB. Stop browser/server before compiler checks.

## Steps
1. Create a PO for an existing supplier; verify its detail page.
2. Create Payment to Supplier with supplierId, purchaseOrderId and amount=100 query parameters. Check the supplier, Prepayment for, currency, bank and amount. Save and Post. Verify Posted and immutable fields.
3. Create Refund from Supplier for that PO, amount 40. Save/Post. Verify the original advance link and $40 application. Void through More options and confirm Voided.
4. Create another refund for 100. Post successfully, proving void restored the full balance. New refund picker must exclude the exhausted PO. Existing posted refund must still display its saved PO link.
5. On a new PO-linked payment, change Type to Refund from Supplier when that PO is exhausted. Verify No document and empty purchaseOrderId/depositDocument hidden fields.
6. Delete the funded PO through its Actions menu. Verify refusal and the PO remains. Void the original advance while its full refund is posted. Verify the credit-consumption refusal and Posted state remains.
7. Create a customer receipt seeded from an overdue invoice. Check the application equals its open balance; Post and open invoice. Verify Paid and payment shown in Payments panel.
8. Open period close. November demo has no uninvoiced shipments (Done); October has two (Warning/Open). Open shipment details and follow its link to the correct Posted shipment. Required operational documents keep Close Period disabled.

## Selector notes
- Wait for hydrated controls with their accessible labels before interacting.
- Use Type button then named option for payment/refund direction.
- Number fields require fill and blur; seeded URL amounts avoid accidental append.
- Keyboard Enter on Post/Void/Save reliably activates them when a persistent realtime-disconnected toast overlays the narrow browser viewport.
- Current payment path is plural `/x/payments`; older create-and-apply-payment playbook has a stale singular path.

## Findings fixed
- New-form type/currency changes left a hidden document selection after it disappeared from options. Clear unavailable selections, preserving saved links.
- Settlement refused stored Overdue/Partially Paid invoice statuses despite offering their open balances. Accept those statuses while retaining ledger/remaining-balance guards.
