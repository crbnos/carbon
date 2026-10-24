# Plan: scrap approval at the tablet

Spec: `.ai/specs/2026-10-24-scrap-approval.md`.

## Steps

- [x] 1. Migration: `scrap` enum value, `scrapRequest` table, `approvalRequests` view branch,
      `scrapRequests` view. Manifest rule; generated authz migration.
- [x] 2. Regenerate DB types.
- [x] 3. `@carbon/ee/approvals`: `scrap` in the type list, label, amount types; a floor of 0
      in the rule validator.
- [x] 4. `@carbon/ee/approvals/scrap.server`: estimate, requirement, authorize, record,
      mark posted, discard, list. `employeesWithPin` in `console.server`. Unit tests for the
      pure decisions (`approvals/scrap.test.ts`).
- [x] 5. MES: shared PIN limits (`pin-limits.server.ts`, console pin-in uses it),
      `scrap-approval.server.ts`, the three routes.
- [x] 6. MES UI: `ScrapApprovalStep` in QuantityModal, ScrapEntityModal, BatchCompleteModal.
- [x] 7. ERP: `createProductionQuantity` / `updateProductionQuantity` gate.
- [x] 8. ERP: Scrap card in Approval Rules; form copy for scrap; the new-rule route reads the
      shared type list.
- [x] 9. ERP: Production → Scrap Approvals list.
- [x] 10. ERP: Set Console PIN visible when a scrap rule is enabled.
- [x] 11. Demo dataset validator: `scrap` exception.
- [x] 12. Docs, rules and AGENTS.md; Lingui extract.
- [x] 13. Verify: typecheck ee / mes / erp, Biome, tests, `db:check:datasets`,
      `db:check:backups`, an end-to-end run through the MES routes on a local stack.

- [x] 14. Independent review: 10 findings. Fixed 8: value binding (`approvedValue`), the
      offered-approver check, batch phase-2 resume, the unconfirmed record on an
      ambiguous failure, the valuation (kitted children, Standard cost), the stale prompt,
      a scrap moved to another operation, and `jobId` SET NULL. The other 2 are known gaps
      in the spec.

- [x] 15. Browser self-test on the local stack (ERP and MES in Chrome). Fixed 3: the PIN pad
      keeps focus after a refused PIN, the ERP refusal no longer tells a lower-tier approver to
      "ask an approver", and a single rule with a floor of 0 reads "of any value". Corrected
      the valuation wording: the estimate is the material in the scrapped units, and the
      scrap journal can write off less.

## Verification log

- `@carbon/ee`, MES and ERP typecheck: clean, after the review fixes.
- `@carbon/ee` tests: 163 files pass; `approvals/scrap.test.ts` 14 pass.
- MES tests: 86 pass. ERP unit tests: 2,739 pass (database tests skip without a database).
- `apps/erp/test/database/scrap-approval.test.ts` (local database): 8 pass.
- `@carbon/checks` test suite: 338 pass.
- `db:check:datasets`: 4 datasets pass. `db:check:backups`: restorable. `authz check`: no drift.
- End-to-end through the MES routes on a local stack: prompt, self refusal, wrong PIN, a
  changed value, an inactive approver, a post with a recorded approval, and a post with
  the rule off. ERP Scrap Approvals and Approval Rules pages render.
- Browser self-test (ERP and MES in Chrome, local stack):
  - Settings → Approval Rules: Scrap card, a second tier at $100 ($0–$100 and over $100),
    disable and re-enable a tier. Users → Employees shows Set Console PIN.
  - MES operation scrap: prompt at $50 and $150 (tier-matched approvers, the operator not
    offered), wrong PIN, right PIN after a wrong one, a quantity change clears the prompt on
    commit, cancel and reopen starts clean, a scrap under every enabled tier posts with no
    prompt, five wrong PINs lock the approver.
  - MES component scrap of an Available serial at $14,500: approved, posted, journal $14,500.
  - MES batch completion with 1 scrapped on one member: $92.75 prompt, approved, batch
    Completed, record posted.
  - ERP job quantities: an approver of the $0 tier records $50 on own authority; $150 is
    refused on create and on edit.
  - Production → Scrap Approvals lists every row with value, recorder, approver and Posted.
