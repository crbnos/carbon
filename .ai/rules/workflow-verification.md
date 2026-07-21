---
paths:
  - ".ai/skills/**"
  - "apps/**"
  - "packages/**"
---

# Verification Workflow

How Carbon approaches claiming work is complete. Every assertion needs matching evidence.

## The Evidence Hierarchy

From lightest (fastest) to heaviest (most expensive):

1. **Type check** — TS compiler validates contracts (fastest)
2. **Lint** — code style + correctness rules
3. **Unit test** — isolated behavior proof
4. **Integration test** — cross-module behavior
5. **Browser verification** — visual/interaction proof
6. **Manual human verification** — last resort

Always pick the **lightest sufficient proof**. Never use browser verification when a unit test suffices.

## Claim → Evidence Mapping

| Claim | Sufficient Evidence |
|-------|-------------------|
| "Function returns correct type" | TS check passes |
| "Logic is correct" | Unit test (red→green) |
| "No regression in touched module" | `pnpm run test --filter=<pkg>` |
| "Migration produces valid schema" | `generate:types` + typecheck |
| "API contract unchanged" | Typecheck on dependent packages |
| "Visual looks right" | Browser screenshot |
| "User flow works end-to-end" | `/test` skill walkthrough |
| "Performance improved" | Benchmark before/after |

## Unverifiable States

When proof is impossible (test data unavailable, environment down):

1. **Document exactly what couldn't be verified** — which claim, what evidence was missing
2. **Don't drop the work** — keep it, flag it
3. **Ship with human verification flag** — draft PR + `agent:needs-verification` label
4. **Provide reproduction steps** — what a human would need to verify

**Absence of proof ≠ disproof.** A change that can't be verified is different from a change that was tested and failed.

## Verification in Loops

The conductor loop (`/conductor`) incorporates this workflow automatically:

- **Doer** builds the change
- **Floor gates** run lint + conformance + clobber checks
- **Per-package typecheck** validates touched packages
- **Behavior gate** (choose unit test or browser) proves the change works
- **Judge** reviews the diff + evidence

Every checkpoint is committed. Failed gates don't drop work — they feed the next iteration.

## Exceptions

Some claims don't need code proof:
- **Copy/clarity/UX polish** — subjective, judged holistically
- **Documentation updates** — read, not run
- **Configuration changes** — verify by inspection or minimal smoke test

When the claim is inherently subjective, state that clearly and rely on human judgment.

## Integration Points

- `/verify` skill — standalone evidence check
- `/conductor` — autonomous loop with built-in verification
- `/fix` — bug fix pipeline with red→green test requirement
- `/check-and-commit` — gate suite before commit

Use `/verify` when declaring completion on any task that wasn't part of a larger orchestrated workflow.
