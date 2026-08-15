# Production Release Boundary Audit

## Scope

This audit identifies current job creation/input paths and the smallest realistic insertion points for a v1 `ProductionRelease` handoff.

## 1) Paths checked

### ERP path (existing, production)
- `apps/erp/app/modules/production/production.service.ts`
  - `convertSalesOrderLinesToJobs` creates rows in `public.job` through Supabase `insert`.
  - This path is already sales-order based, not ERP Work Order object-to-carbon-release specific.

### ERP Job/operation update paths
- ERP service functions query and mutate `job`/related tables in `apps/erp/app/modules/production/*` and `apps/erp/app/modules/items/*`.
- Several paths call edge functions (`get-method`, `recalculate`) and mutate job lifecycle data.

### MES path (observed)
- MES app routes and services operate on existing jobs and operations.
- In this branch, no dedicated API service was found that performs **new Carbon Job creation from an external release payload**.

## 2) Existing metadata that can carry lineage

- `public.job` does not expose explicit source-system fields dedicated to ERP release lineage.
- `customFields` (JSON) exists on job-related database rows and could carry lineage metadata, but that is not currently standardized as a release contract in this branch.
- No migration is present to safely reserve canonical ERP-release columns.

## 3) Chosen insertion strategy

Given the current constraints, the safest v1 strategy is:

- Keep runtime proofing/documentation at contract and projection level in `@carbon/utils`.
- Do **not** fabricate lineage persistence in non-review-safe paths.
- Use a future adapter (ERP-side adapter or API input route) that writes release identity and source references into a dedicated migration-backed field (preferred) or stable `customFields` envelope (fallback).

## 4) Compatibility risks

- ERP→MES handoff in production is currently not proven as a direct runtime integration in this branch.
- Legacy jobs (without lineage proof) must remain readable and unlinked.
- Any immediate schema extension requires migration and duplicate-safe idempotency handling.
