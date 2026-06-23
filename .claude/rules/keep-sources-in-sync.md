---
paths:
  - "apps/**"
  - "packages/**"
  - "docs/**"
  - ".claude/rules/**"
---

# Keep docs and rules fresh with their source of truth

Source of truth for how Carbon works, in order:

1. **Code + database schema** — the real behavior.
2. **Product docs** — `docs/` (the Fumadocs site; reader-facing).
3. **Rules** — `.claude/rules/*.md` (internal technical index, auto-loaded by `paths:`).

Lower tiers describe higher tiers, never the reverse. If a rule or doc disagrees
with the code, the **code wins** — fix the rule/doc, don't trust the stale text.

## When you change code or schema, sync the dependents

- **`.claude/rules/<subsystem>.md`** — when you change a subsystem's tables,
  functions, flows, or file layout, update the matching rule. Its `paths:`
  frontmatter tells you which code it tracks. Document **committed** code only —
  never staged/uncommitted work. Mark anything you can't verify against the code
  `<!-- UNVERIFIED: ... -->`.
- **`docs/` product docs** — if the change is user-facing (a feature, workflow,
  field, or behavior a customer sees), update the relevant page under
  `docs/content/`. Use the `carbon-docs` skill and ground every claim in source,
  not in a rule.
- **`docs/lib/*.generated.ts`** is generated from the OpenAPI schema + MCP tool
  metadata by `docs/scripts/generate-api-docs.mjs` — never hand-edit; it
  regenerates via `pnpm --filter docs generate:api` (also runs on `dev`/`build`).

## Catching drift

- A rule or doc that names a file, function, table, or command that no longer
  exists is stale — fix it the moment you notice; don't propagate it.
- Prefer deleting a wrong line over leaving it. A confidently-wrong rule or doc
  is worse than a missing one.
