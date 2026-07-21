---
name: verify
description: Match evidence to claim type before declaring work complete. Run after any change to ensure proof strength matches the assertion. Not a full test suite — choose the minimal sufficient proof. Use 'Using the verify skill — checking {claim type}.' Works with /fix, /conductor, and individual task completion.
---

# verify — evidence-based completion check

Run before claiming "done" on any change. Choose the **simplest sufficient proof** — never heavier than needed. The proof must match the claim type; evidence mismatch = not done.

## Claim Types and Required Evidence

| Claim Type | Proof Method | Command |
|------------|--------------|---------|
| **Logic change** | Unit test (red→green) | `pnpm run test --filter=<pkg> -- <test-pattern>` |
| **Visual/UX fix** | Browser screenshot (before/after) | `crbn up`, `/test` skill, capture screenshots |
| **Database migration** | Type generation + query | `pnpm run generate:types && pnpm exec turbo run typecheck --filter=@carbon/database` |
| **API contract** | Type check on dependents | `pnpm exec turbo run typecheck --filter=<dependent-pkgs>` |
| **No regression** | Existing test suite | `pnpm run test --filter=<touched-pkg>` |
| **Performance** | Benchmark/profiler output | `pnpm --filter <pkg> bench` or profiler dump |
| **Behavior gate** | Browser verification | `/test` skill with specific flow |

## Protocol

1. **Identify the claim** — what are you asserting? ("X behaves like Y", "Z bug is fixed", "No breakage")
2. **Match to evidence type** — use the table above
3. **Run the proof** — execute the command/verification
4. **Record evidence** — show output, screenshot, or test result
5. **If unverifiable** — state what proof is missing and what a human would need to do

## Unverifiable vs. Disproved

- **Unverifiable** — proof was impossible given constraints (test data unavailable, environment issues). Work is kept, flagged for human verification.
- **Disproved** — reached the state and the change didn't work. Fix forward.

**Unverifiable is not failure.** Disproved is failure.

## Examples

**Logic change (service function):**
```bash
# Add test demonstrating the fix
pnpm run test --filter=@carbon/sales -- getCustomer
# Output shows: PASS ✓ should return customer for valid id
# Claim proven.
```

**Visual bug (layout overflow):**
```bash
crbn up
# Use /test to navigate to the affected screen
# Capture BEFORE screenshot (broken state)
# Apply fix
# Capture AFTER screenshot (fixed state)
# Claim: "overflow hidden on mobile" proven by visual comparison.
```

**Database migration:**
```bash
# After migration applied:
pnpm run generate:types
pnpm exec turbo run typecheck --filter=@carbon/database
# Success + query in psql or app demonstrates schema works.
```

## Completeness Checklist

Before declaring "done":
- [ ] Claim type identified
- [ ] Matching evidence method selected
- [ ] Proof executed and recorded
- [ ] If unverifiable → documented gap, work not dropped

**No checklist box without evidence.** Run the command, show the output.
