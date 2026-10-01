# Rewrite technical documentation

## Scope

Rewrite the authored product documentation in `docs/content/docs/` and
`docs/content/guides/` for clarity, concision, and technical precision. Preserve
frontmatter, public URLs, heading anchors, links, examples, component markup, and
documented behavior. Application code and historical changelog entries are out of
scope.

## Plan

- [x] Inventory pages and assign non-overlapping content groups.
- [x] Rewrite building, platform, integration, overview, and glossary pages.
- [x] Rewrite reference pages.
- [x] Rewrite task guides.
- [x] Review the complete diff for consistency, accidental semantic changes, and
      broken MDX structure.
- [x] Run `@carbon/content` typecheck, tests, and lint.
- [x] Record verification results and summarize the rewrite.

## Verification log

- Rewrote all 108 authored pages under `docs/content/docs/` and
  `docs/content/guides/`.
- Reduced the corpus from 122,888 to 110,251 words.
- Confirmed all Markdown headings and code-fence counts match `origin/main`.
- `pnpm --filter docs exec fumadocs-mdx` passed.
- `pnpm --filter @carbon/content typecheck` passed.
- `pnpm --filter @carbon/content test` passed: 3 files, 17 tests.
- `pnpm --filter @carbon/content lint` passed with no fixes.
- `pnpm --filter docs typecheck` passed.
- `git diff --check` passed.
