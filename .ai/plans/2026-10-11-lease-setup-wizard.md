# Lease setup wizard

Rewrite the Draft lease UI to the setup-wizard pattern contracts and rental
agreements use (`~/components/Setup`, `x+/rental-agreement+/$id.setup*`). An
active lease keeps its page.

Precedent copied file for file: `x+/rental-agreement+/{new,$id,$id._index,$id.details,$id.setup,$id.setup._index,$id.setup.*}.tsx`,
`modules/sales/ui/Rentals/{RentalSetupSteps,RentalAgreementDetailsForm,RentalAgreementBilling,RentalAgreementAccounting,RentalUnitsGrid}.tsx`,
`draftRentalAgreementSetupPath` (`sales.server.ts`).

Steps: **Details → Payments → Accounting → Review**.

- [x] 1. `path.to.leaseSetup(id, step)`; `draftLeaseSetupPath` in `purchasing.server.ts`.
- [x] 2. `LeaseSetupSteps` + `leaseSetupSteps` + `useLeaseTermSave` (posts one term to `leaseUpdate`).
- [x] 3. `LeaseDetailsForm` (replaces `LeaseForm`): Lessor, Leased Asset, Term, More Details in `SetupBody`/`SetupSection`; payment and accounting terms carried as hidden fields; footer Next.
- [x] 4. `new.tsx` → `SetupFrame`; creates the Draft, redirects to `setup/payments`.
- [x] 5. `$id.setup.tsx` shell, `$id.setup._index.tsx`, `$id.setup.details.tsx` (saves; cuts rows again when a date changed and rows exist).
- [x] 6. `$id.setup.payments.tsx`: `LeasePaymentTerms` (amount, frequency, timing, escalation; each saves on its own and cuts the rows again) + `LeasePaymentsGrid` (editable cells via `$id.payments.$paymentId.update.tsx`, add, delete).
- [x] 7. `$id.setup.accounting.tsx`: `LeaseAccounting` (discount rate, fair value, economic life, purchase option, switches, live classification + override).
- [x] 8. `$id.setup.review.tsx`: summary, gaps, commencement preview; footer Save as Draft / Activate.
- [x] 9. `$id.tsx` renders the setup full-page; `$id._index` / `$id.details` send an editor's Draft to setup. Remove the Draft-only page affordances the wizard replaces.
- [x] 10. Docs (`leases.mdx`, purchasing AGENTS.md, playbook), design-archetype note, typecheck, Biome, lingui, browser test.
