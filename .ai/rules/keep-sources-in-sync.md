---
paths:
  - "apps/**"
  - "packages/**"
  - "docs/**"
  - ".ai/**"
  - "**/AGENTS.md"
  - "BACKWARD_COMPATIBILITY.md"
---

# Keep docs, rules, and AGENTS.md fresh with their source of truth

Source of truth for how Carbon works, in order:

1. **Code + database schema** — the real behavior.
2. **Product docs** — `docs/` (the Fumadocs site; reader-facing).
3. **Rules** — `.ai/rules/*.md` (internal technical index, auto-loaded by `paths:`).
4. **AGENTS.md** — agent guides at root, package, and module level (discovery + safety boundaries).
5. **`.ai/`** — lessons, specs, design system rules, QA approach, domain docs.

Lower tiers describe higher tiers, never the reverse. If any doc disagrees
with the code, the **code wins** — fix the doc, don't trust the stale text.

## When you change code or schema, sync the dependents

### Rules (`.ai/rules/`)

- When you change a subsystem's tables, functions, flows, or file layout,
  update the matching rule. Its `paths:` frontmatter tells you which code it
  tracks. Document **committed** code only — never staged/uncommitted work.
  Mark anything you can't verify against the code `<!-- UNVERIFIED: ... -->`.

### AGENTS.md (root, package, module)

- When you **add, rename, or remove** a service function, table, export, or
  import path that an AGENTS.md references, update that AGENTS.md in the
  same PR.
- When you change a package's public API (exports, key patterns, validation
  commands), update `packages/{name}/AGENTS.md`.
- When you change a module's data model, business rules, or service functions,
  update `apps/erp/app/modules/{name}/AGENTS.md`.
- When you add a new module or package, create its AGENTS.md. Use an existing
  sibling as a template.
- The root `AGENTS.md` Task Router only needs updating when new subsystems or
  guide files are added — it points to other files, not to code directly.

### `.ai/` Knowledge Base

- **`lessons.md`** — when you hit a new pitfall or learn something that would
  prevent a future mistake, add it using the `Context → Problem → Rule →
  Applies to` format. Review whether existing lessons are still accurate
  when you work in their area.
- **`specs/`** — update the spec when implementation diverges from the design.
  Move to `specs/implemented/` when done.
- **`ds-rules.md`** — update when the component library adds, removes, or
  renames components or variants.
- **`docs/module-conventions.md`** — update when module layout conventions
  change.

### Product Docs (`docs/`)

- If the change is user-facing (a feature, workflow, field, or behavior a
  customer sees), update the relevant page under `docs/content/`. Use the
  `carbon-docs` skill and ground every claim in source, not in a rule.
- `docs/lib/*.generated.ts` is generated from the OpenAPI schema + MCP tool
  metadata by `docs/scripts/generate-api-docs.mjs` — never hand-edit; it
  regenerates via `pnpm --filter docs generate:api` (also runs on `dev`/`build`).

## Catching drift

- A rule, AGENTS.md, or doc that names a file, function, table, or command
  that no longer exists is **stale** — fix it the moment you notice; don't
  propagate it.
- Prefer deleting a wrong line over leaving it. A confidently-wrong doc is
  worse than a missing one.
- When reviewing a PR: if it touches a package or module directory, check
  whether the sibling AGENTS.md needs updating.
- **Self-healing loop**: the conductor reads AGENTS.md before building. If it
  discovers something inaccurate during the build, it updates the AGENTS.md
  as part of the same PR.
