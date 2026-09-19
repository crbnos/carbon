# Ramp sync module extraction

- [x] Establish the green characterization baseline and inventory every top-level helper and Inngest family block.
- [x] Extract shared context, monetary, tenancy, link, and attachment helpers without changing call behavior.
- [x] Extract card/transfer/cashback workflows and their family drains.
- [x] Extract bill creation/payment and reimbursement family drains.
- [x] Extract repayment and outbound workflows, including cursor advancement.
- [x] Reduce `ramp-sync.ts` to the unchanged Inngest contract plus thin `step.run` orchestration and confirm it is under 1,000 lines.
- [x] Run focused/full Jobs tests, Jobs+EE typechecks, focused Biome, and `git diff --check`.

## Verification

```bash
pnpm --filter @carbon/jobs test
RUN_RAMP_DB_TESTS=true pnpm --filter @carbon/jobs exec vitest run src/inngest/functions/integrations/ramp-sync-transaction.integration.test.ts
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/ee
pnpm exec biome check --diagnostic-level=error packages/jobs/src/inngest/functions/integrations/ramp-sync*.ts
git diff --check
wc -l packages/jobs/src/inngest/functions/integrations/ramp-sync*.ts
```
