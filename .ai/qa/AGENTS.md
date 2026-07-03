# QA — Agent Guidelines

Quality assurance approach for Carbon. Tests verify that code changes work correctly and don't break existing functionality.

## Always

- Write tests for non-trivial logic changes — especially service functions, validators, and utilities.
- Test the happy path AND at least one error/edge case.
- Use existing test patterns from the same module or package as a template.
- Run `pnpm run test` before opening a PR.
- Verify changes manually when automated tests aren't sufficient (use browser automation skills).

## Ask First

- Ask before changing test infrastructure (Vitest config, test utilities, CI setup).
- Ask before skipping or deleting existing tests.

## Never

- Never leave broken tests — fix them or `test.skip()` with a reason comment.
- Never hardcode dates in tests that will become stale (use relative dates or mocks).
- Never rely on database state from other tests — each test should set up its own data.

## Test Structure

### Unit Tests

Location: alongside source files or in `__tests__/` directories.

```
packages/{package}/src/{file}.test.ts    # next to source
packages/{package}/src/__tests__/        # or in test dir
```

### Testing Stack

- **Framework**: Vitest (configured via `@carbon/config` preset)
- **Assertions**: Vitest built-in (`expect`, `describe`, `it`)
- **Mocking**: Vitest mocking (`vi.mock`, `vi.fn`)

### Test Pattern

```typescript
import { describe, it, expect } from "vitest";
import { myFunction } from "./myModule";

describe("myFunction", () => {
  it("should handle the happy path", () => {
    const result = myFunction(validInput);
    expect(result).toEqual(expectedOutput);
  });

  it("should handle edge cases", () => {
    expect(() => myFunction(invalidInput)).toThrow();
  });
});
```

## What to Test

| Change Type | Test Requirement |
|-------------|-----------------|
| New utility function | Unit test with happy path + edge cases |
| New service function | Unit test if pure logic; manual verify if DB-dependent |
| New zod validator | Test with valid and invalid inputs |
| New UI component | Manual verification via browser; snapshot test if complex |
| Bug fix | Regression test that reproduces the bug |
| Database migration | Manual verification — don't auto-apply in tests |
| Route loader/action | Manual verification via browser automation |

## Validation Commands

```bash
pnpm run test                    # Run all tests
pnpm run test -- --watch         # Watch mode
pnpm run test -- path/to/file    # Run specific test
pnpm run typecheck               # Type checking
pnpm run lint                    # Linting
```

## Browser Automation

For UI verification, use the `/auth` and `/test` skills with the user's permission. This allows testing route behavior, form submission, and visual correctness.

## Cross-References

- Test configuration: `packages/config/` (Vitest preset)
- Conformance checks: `packages/checks/` (baseline, clobber detection)
- Build verification: `packages/harness/` (gates for conductor loop)
