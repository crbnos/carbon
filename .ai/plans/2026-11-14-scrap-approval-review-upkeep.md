# Plan: scrap approval upkeep after main moved (2026-11-14)

Spec: `.ai/specs/2026-10-24-scrap-approval.md`. Feature plan: `.ai/plans/2026-10-24-scrap-approval.md`.

## Steps

- [x] 1. Rebase onto main `ef3354481c` (the branch has always been rebased, never merged).
      Conflicts: the MES quantity modal (main's tracked-material imports beside the
      approval step), `swagger-docs-schema.ts` (main's two force-delete approval types
      before `scrap`), the backup manifest's schema version, and `closeIssue`'s catch
      (main's logging contract beside the approval settlement).
- [x] 2. Date the three migrations after main's newest (`20261114164505`), keeping order
      and content. The `approvalRequests` view already carries main's newest definition
      (`20261110230000`); main has not changed it or `approvalDocumentType` since.
- [x] 3. Main's logger has no `warn`: the two places that keep an unconfirmed approval log
      with `warning`.
- [x] 4. Review: a direct Scrap row naming another company's operation is refused by
      `prevent_direct_scrap_write`; the generated authz migration is regenerated with it.
      Live-database test added.
- [x] 5. Review: the batch route's "did it post anyway" read throws on a failed read, so the
      approval is kept, not removed.
- [x] 6. Review: `hasScrapApprovalRules` reads the plan with `companyHasFeatureOrThrow`
      (`@carbon/ee/plan.server`), on `getCompanyPlanIdOrThrow` (`@carbon/auth/company.server`):
      a failed plan read refuses the scrap instead of turning the rules off. Unit tests in
      both packages.
- [x] 7. Docs: ee and auth AGENTS.md, `commercial-licensing.md`, `billing-system.md`, the
      spec's known gaps.

## Verification log

- Typecheck `@carbon/auth`, `@carbon/ee`, `mes`, `erp`; Biome on changed files.
- `@carbon/ee` tests (`plan.server`, `plan`, `approvals`), `@carbon/auth`
  `company-plan-cache`, `@carbon/database` `authz/migration`, `@carbon/checks` clobbers.
- Not run: the live-database tests (`apps/erp/test/database/scrap-approval.test.ts`),
  `db:check:datasets`, `db:check:backups`: no stack for this worktree.
