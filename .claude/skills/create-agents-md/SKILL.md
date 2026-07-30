---
name: create-agents-md
description: Create or refresh an AGENTS.md for a Carbon package or ERP module by reading the actual source code — every claim traced to a real function, table, or export. Use when adding a new module/package, when the conductor's freshness audit or /self-review flags a stale AGENTS.md, or on explicit request. Do not write an AGENTS.md from memory or by copying a sibling's content.
---
<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

# create-agents-md — generate or refresh an AGENTS.md

Produce a prescriptive AGENTS.md grounded in source. Every claim MUST trace to a
real function name, table name, import path, or file — grep and verify; never
describe what "might" exist.

**Announce at start:** "Using the create-agents-md skill — generating/refreshing
the AGENTS.md for {target}."

## Step 1: Identify the target

- **Package**: `packages/{name}/` → budget ≤100 lines
- **Module**: `apps/erp/app/modules/{name}/` → budget 60–100 lines

## Step 2: Read the actual source

```bash
# Module:
ls apps/erp/app/modules/{name}/
grep -n "^export" apps/erp/app/modules/{name}/{name}.service.ts
grep -n "export const.*=.*z\." apps/erp/app/modules/{name}/{name}.models.ts
grep -rn "\.from(" apps/erp/app/modules/{name}/{name}.service.ts | sed 's/.*\.from("\([^"]*\)").*/\1/' | sort -u
grep -rn "\.rpc(" apps/erp/app/modules/{name}/ | sed 's/.*\.rpc("\([^"]*\)".*/\1/' | sort -u
grep -rn "requirePermissions" apps/erp/app/routes/x+/{name}* | head -10

# Package:
ls packages/{name}/src/
cat packages/{name}/src/index.ts
cat packages/{name}/package.json | jq '.exports'
```

## Step 3: If refreshing, read the existing file

- **Preserve** human-added notes, warnings, and domain explanations.
- **Update** stale function/table/import names (verify each with grep).
- **Add** new exports/tables/patterns; **remove** references to deleted code.

## Step 4: Read the relevant rules

Find the `.claude/rules/` files that govern this area (via the root `AGENTS.md`
Task Router) and reference them in the Rules References section — only files
that actually exist.

## Step 5: Write it

### Module template

````markdown
# {Module Name} Module

{One line: what this module does in the ERP domain.}

## Key Domain Concepts
{3–6 terms a non-manufacturing AI needs. **Term** — plain-English definition.
 Include status lifecycles.}

## Safety
### Always
- MUST {do X} — `{function/table}` depends on it.   {3–5 rules, grounded}
### Ask First
- {action} — {why risky}.                            {2–3 items}
### Never
- {action} — {what breaks}.                          {2–3 items}

## Validation Commands
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test
```

## Key Data Model
| Table / View | Purpose |
|---|---|

## Key Service Functions
- `{functionName}` — {what it does}   {only what another module would call}

## Copy From   {OPTIONAL — only if this module is a good template}
| To build… | Copy from… | Then change… |

## Related Modules
- **{module}** — {integration point}

## Rules References
- `.claude/rules/{file}.md` — {what it covers}
````

### Package template

````markdown
# @carbon/{name}

{One line.}

## Always / Ask First / Never
{Same shape as the module template.}

## Validation Commands
```bash
pnpm --filter @carbon/{name} typecheck
pnpm --filter @carbon/{name} test
```

## Key Exports
| Subpath | Provides |
|---------|----------|
| `.` | {…} |          {real subpaths from package.json exports}

## Cross-References
{rules, related packages, consuming apps}
````

## Done when — verify each line

- [ ] Every function name exists: `grep -n "export.*{name}" {file}` hits
- [ ] Every table name exists: grep in the service file hits
- [ ] Every import path is real (check the barrel / exports field)
- [ ] Every referenced `.claude/rules/` file exists
- [ ] Tone is prescriptive ("MUST use X"), not descriptive ("X is used")
- [ ] Line count within budget; no `{placeholder}` / TBD left
- [ ] Modules: Key Domain Concepts present; Never section present
- [ ] Refresh: human-added notes preserved

## Anti-patterns

- Listing functions you didn't grep for (renamed/deleted ones will lie)
- Abstract architecture prose ("uses a service layer" says nothing)
- Copying a sibling AGENTS.md and renaming — every module has different tables,
  functions, and concepts
- Vague bullets: "Services handle data access" ❌ vs
  "MUST use `insertManualInventoryAdjustment` for quantity changes — it creates
  ledger entries and updates tracked entities" ✅
