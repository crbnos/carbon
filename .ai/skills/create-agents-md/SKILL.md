<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->
---
name: create-agents-md
description: Create or refresh an AGENTS.md for a Carbon package or ERP module. Reads actual source code, existing AGENTS.md, and .ai/rules/ to produce a prescriptive, grounded document. Use when adding a new module/package or when a build touches code that an existing AGENTS.md references.
---

# create-agents-md — Generate or Refresh AGENTS.md

Produce a prescriptive AGENTS.md grounded in actual source code. Every claim
MUST trace to a real function name, table name, import path, or file. Never
describe what "might" exist — grep and verify.

**Announce at start:** "I'm using the create-agents-md skill to generate/refresh the AGENTS.md."

## When to Use

| Trigger | Action |
|---------|--------|
| New package or module directory created | Create AGENTS.md |
| Conductor post-build freshness audit flags staleness | Refresh AGENTS.md |
| Explicit request (`/create-agents-md modules/purchasing`) | Create or refresh |
| Self-review flags missing AGENTS.md | Create AGENTS.md |

## Procedure

### Step 1: Identify the target

Determine whether the target is a **package** (`packages/{name}/`) or a
**module** (`apps/erp/app/modules/{name}/`). This decides layout expectations,
line-length budget, and which conventions apply.

- **Package:** `≤100 lines`
- **Module:** `60–100 lines`

### Step 2: Read actual source code

Do NOT write from memory or assumptions. Read the real files:

```bash
# For a module:
ls apps/erp/app/modules/{name}/
cat apps/erp/app/modules/{name}/{name}.service.ts
cat apps/erp/app/modules/{name}/{name}.models.ts
cat apps/erp/app/modules/{name}/index.ts
ls apps/erp/app/modules/{name}/ui/ 2>/dev/null

# For a package:
ls packages/{name}/src/
cat packages/{name}/src/index.ts
cat packages/{name}/package.json | jq '.exports'
```

Grep for concrete artifacts:

```bash
# Find exported functions
grep -n "^export " apps/erp/app/modules/{name}/{name}.service.ts

# Find tables this module touches
grep -rn "\.from(" apps/erp/app/modules/{name}/{name}.service.ts | sed 's/.*\.from("\(.*\)").*/\1/' | sort -u

# Find zod validators
grep -n "export const.*=.*z\." apps/erp/app/modules/{name}/{name}.models.ts

# Find route permission scopes
grep -rn "requirePermissions" apps/erp/app/routes/x+/{name}* | head -10

# Find RPCs
grep -rn "\.rpc(" apps/erp/app/modules/{name}/ | sed 's/.*\.rpc("\(.*\)".*/\1/' | sort -u
```

### Step 3: Read existing AGENTS.md (if refreshing)

```bash
cat apps/erp/app/modules/{name}/AGENTS.md 2>/dev/null
# or
cat packages/{name}/AGENTS.md 2>/dev/null
```

If refreshing:
- **Preserve** any human-added notes, warnings, or domain explanations
- **Update** stale function names, table names, imports, or cross-references
- **Add** new exports, tables, or patterns introduced since last write
- **Remove** references to deleted code (verify deletion with `grep`)

### Step 4: Read relevant .ai/rules/ files

```bash
ls .ai/rules/
# Load rules that apply to this module/package
cat .ai/rules/conventions-index.md
```

Identify which rules files are relevant (e.g., `conventions-database.md` for
database packages, module-specific rules like `purchasing-conversion-factors.md`).

### Step 5: Generate the AGENTS.md

Follow the template below. Every section is mandatory unless marked optional.

---

## Template: Module AGENTS.md

```markdown
# {Module Name} Module

{One-line description of what this module does in the ERP domain.}

## Key Domain Concepts

{For AI agents unfamiliar with manufacturing/ERP — explain 3–6 domain terms
 that appear in the code. Use bold term + dash + plain-English definition.
 Include status lifecycles where they exist.}

- **{Term}** — {definition}

## Safety

### Always
{3–5 prescriptive rules. Use MUST language. Ground in real code.}
- MUST {do X} — `{function/table}` depends on this.

### Ask First
{2–3 items where human judgment is needed.}
- {action} — {why it's risky}.

### Never
{2–3 hard prohibitions with rationale.}
- {action} — {what breaks if you do}.

## Validation Commands

{Exact shell commands to verify changes in this module.}

```bash
pnpm --filter {package} typecheck
pnpm --filter {package} test
# Module-specific checks
```

## Key Data Model

{Main tables this module owns. Use a table. Include purpose column.}

| Table / View | Purpose |
|---|---|
| `{table}` | {one-line purpose} |

## Key Service Functions

{Real exported functions from {name}.service.ts. List the important ones
 — not every helper, just what another module would call.}

- `{functionName}` — {what it does}

## Key Exports

{For packages: subpath exports from package.json. For modules: barrel
 exports from index.ts. Use real import paths.}

```typescript
import { {export} } from "~/modules/{name}";
// or
import { {export} } from "@carbon/{name}";
```

## Copy From

{OPTIONAL — only if this module/package is a good template for new ones.
 Table showing what to copy and what to change.}

| To build… | Copy from… | Then change… |
|-----------|-----------|--------------|
| {new feature} | `{file}` | {what to adapt} |

## Related Modules

{Cross-references to modules this one interacts with. One bullet per
 module, explain the integration point.}

- **{module}** — {how they interact}

## Rules References

{Pointers to .ai/rules/ files that govern this module's patterns.}

- `.ai/rules/{file}.md` — {what it covers}
```

---

## Template: Package AGENTS.md

```markdown
# @carbon/{name}

{One-line description.}

## Always

{3–5 prescriptive rules with MUST language.}

## Ask First

{2–3 items.}

## Never

{2–3 prohibitions with rationale.}

## Validation Commands

```bash
pnpm --filter @carbon/{name} typecheck
pnpm --filter @carbon/{name} test
```

## Key Exports

{Subpath export table. Use real subpaths from package.json exports field.}

| Subpath | Provides |
|---------|----------|
| `.` | {what the default export gives} |
| `./{sub}` | {what this subpath gives} |

## Cross-References

{Pointers to rules, related packages, consuming apps.}
```

---

## Quality Checklist

Before saving the AGENTS.md, verify:

- [ ] **Every function name** listed actually exists (`grep -n "export.*{name}" {file}`)
- [ ] **Every table name** listed actually exists (`grep -rn "from.*{table}" {file}`)
- [ ] **Every import path** listed is real (`cat {index} | grep {export}`)
- [ ] **Tone is prescriptive** — "MUST use X", not "X is used"
- [ ] **Line count** is within budget (≤100 for packages, 60–100 for modules)
- [ ] **No placeholders** — no `{TODO}`, `TBD`, or `fill in later`
- [ ] **Domain concepts section** exists (modules only) and explains terms a non-manufacturing AI would need
- [ ] **Cross-references** to `.ai/rules/` files are present and the files exist
- [ ] **Human-added notes** are preserved (if refreshing)

## Anti-Patterns

- ❌ Listing functions you didn't grep for — they may have been renamed or deleted
- ❌ Describing architecture abstractly — "uses a service layer" says nothing useful
- ❌ Copying another module's AGENTS.md and changing the name — each module has different tables, functions, and domain concepts
- ❌ Exceeding line budget — if it's too long, cut the least useful entries from Key Service Functions or Key Data Model
- ❌ Omitting the Never section — every module has destructive actions worth prohibiting

## Examples of Good vs Bad

**Bad:**
```
- Services handle data access
- The module uses Supabase for queries
```

**Good:**
```
- MUST use `insertManualInventoryAdjustment` for quantity changes — it creates
  proper ledger entries and handles tracked entity updates.
- MUST scope by `companyId` and `locationId` — inventory is location-scoped.
```

**Bad:**
```
## Key Functions
- Various CRUD operations for the module
```

**Good:**
```
## Key Service Functions
- `getPurchaseOrder` / `getPurchaseOrders` / `getPurchaseOrderLines` — read POs
- `closePurchaseOrder` — marks a PO closed
- `convertSupplierQuoteToOrder` — calls `convert` edge function
```
