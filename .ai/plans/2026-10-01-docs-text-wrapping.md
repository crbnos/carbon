# Docs text wrapping

## Plan

- [x] Apply balanced wrapping to documentation headlines.
- [x] Apply improved wrapping to documentation body paragraphs.
- [x] Verify formatting, docs typechecking, and the production docs build.
- [x] Commit and push the change to the existing pull request.

## Verification log

- `pnpm --filter docs typecheck` — passed.
- `pnpm --filter docs build` — passed; generated 2,201 static pages.
- Compiled CSS contains the scoped `text-wrap: balance` and
  `text-wrap: pretty` declarations.
- `git diff --check` — passed.
