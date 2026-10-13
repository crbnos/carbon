# Bugfix run: Ramp allocation remediation

- Date: 2026-09-10
- Mode: fully-autonomous
- Request: "let's get to work"
- Phase plan: root-cause [resume from nuclear self-review] · instrument [skip — deterministic pure functions] · fix [run] · test [skip — regression tests cover pure logic] · commit [skip — not explicitly requested]

## Decisions

- Scope: repair the deterministic allocation blocker first; broader schema, authentication, and unverified Ramp API work remains gated by repository-required approvals and external contract evidence.
- Allocation: use the canonical `distributeRoundingResidual` helper and reject nonzero targets with no allocation basis.

## Phase log

- root-cause: HIGH — the Ramp helpers concentrate residual on one line and fabricate a nonzero result from a zero basis, contradicting the canonical precision contract.
- fix: RED confirmed with six targeted failures; GREEN after extracting `allocation.ts`, delegating rounding to `distributeRoundingResidual`, and rejecting non-finite or basis-free nonzero allocations.
- test: browser test skipped — the behavior is pure financial allocation and is covered by regression tests.

## Outcome

- READY — 42 targeted tests and all 1,098 `@carbon/ee` tests pass; `@carbon/ee` and `@carbon/jobs` typechecks pass; Biome passes with three pre-existing `service.ts` console warnings.
