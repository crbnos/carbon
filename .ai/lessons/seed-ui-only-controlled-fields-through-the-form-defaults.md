---
paths: ["apps/erp/app/modules/invoicing/ui/Payment/PaymentForm.tsx", "apps/erp/app/modules/invoicing/ui/Payment/PaymentApplyTable.tsx"]
triggers: ["SelectControlled", "paymentKind"]
promoted: null
---
# Seed UI-only controlled fields through the form defaults

**Context:** Payment type choices combine counterparty and cash direction while the persisted paymentType remains Receipt or Disbursement.

**Problem:** Passing only SelectControlled.value left the initial registered paymentKind empty in the real browser; unit mocks did not model form initialization. A composer also retained old targets after a saved header identity changed.

**Rule:** Include a UI-only field's initial value in ValidatedForm defaults, and key stateful composers by the document/party/currency/direction identity whose data they hold. Verify the initial label and actual submitted fields in the browser.

**Applies to:** PaymentForm, PaymentApplyTable, and other forms using derived presentation choices.
