# Address CodeRabbit documentation review

## Plan

- [x] Verify all eight review findings against current source code.
- [x] Correct the seven affected MDX pages with minimal, source-grounded edits.
- [x] Run the Carbon docs mechanical checks for every touched page.
- [x] Run `@carbon/content` lint, typecheck, and tests.
- [x] Run the docs typecheck and production build.
- [x] Commit and push the fixes, then reply to and resolve each review thread.

## Files

- `docs/content/docs/building/architecture.mdx`
- `docs/content/docs/building/webhooks.mdx`
- `docs/content/docs/platform/licensing.mdx`
- `docs/content/docs/reference/financial-reports.mdx`
- `docs/content/docs/reference/onboarding.mdx`
- `docs/content/guides/floor.mdx`
- `docs/content/guides/ship.mdx`

## Verification log

- Carbon docs mechanical checks — passed for all seven MDX pages.
- `pnpm --filter @carbon/content lint` — passed.
- `pnpm exec turbo run typecheck --filter=@carbon/content` — passed.
- `pnpm --filter @carbon/content test` — passed, 17 tests.
- `pnpm --filter docs typecheck` — passed.
- `pnpm --filter docs build` — passed, 2,125 static pages generated.
- `git diff --check` — passed.
