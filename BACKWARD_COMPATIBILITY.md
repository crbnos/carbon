# Backward Compatibility Contract

This document defines Carbon's stability surfaces. Every AI agent and human contributor MUST respect these contracts when making changes.

## Stability Levels

| Level | Meaning | What You Can Do |
|-------|---------|-----------------|
| **FROZEN** | Never change once shipped | Nothing — add new, don't modify existing |
| **STABLE** | Additive changes only, deprecation protocol for removals | Add new fields/params. To remove: deprecate → bridge → wait one release |
| **ADDITIVE-ONLY** | Only add, never rename or remove | Add new columns/tables. Never rename, drop, or narrow types |

## Contract Surfaces

### Database Schema — ADDITIVE-ONLY

- Never rename a column or table in a migration
- Never drop a column that might contain data
- Never narrow a column type (e.g., `TEXT` → `VARCHAR(50)`)
- Adding columns, tables, indexes, and constraints is always safe
- Use `ALTER TABLE ... ADD COLUMN` with defaults or nullable columns

### Permission Scope Strings — FROZEN

Permission strings like `"purchasing"`, `"inventory"`, `"sales"`, `"production"` are stored in the database and referenced across the entire codebase as string literals.

- Never rename a permission scope
- Adding new scopes is safe
- If a scope must change, create a new one and keep the old one working via alias

### RLS Policy Names — STABLE

Standard policy names follow the pattern `{table}_{SELECT|INSERT|UPDATE|DELETE}`.

- Never rename an existing policy without a migration that drops old + creates new
- Keep the naming convention consistent across all tables

### Service Function Signatures — STABLE

Service functions in `{module}.service.ts` are called from route loaders/actions across the app.

- Add optional parameters (with defaults) freely
- Never remove a parameter or change its type without updating all callers
- Never change return shape without updating all consumers

### Route Paths — STABLE

Route paths are used in redirects, links, and external integrations.

- Never rename a route path without adding a redirect from the old path
- Adding new routes is always safe

### Edge Function Names — FROZEN

Edge functions deployed to Supabase are referenced by name in configuration and triggers.

- Never rename an edge function
- Adding new edge functions is safe

### Event Types (Inngest) — FROZEN

Event type strings like `"purchasing.create"` are used in `trigger()` calls and Inngest function definitions.

- Never rename an event type
- Adding new event types is safe
- Event payload shapes are STABLE — add fields, don't remove them

### Component Props (packages/react) — STABLE

UI components in `@carbon/react` are consumed across all apps.

- Add new optional props freely
- Never remove a prop without deprecation
- Never change a prop's type in a breaking way

### Import Paths — STABLE

Import paths like `@carbon/auth/auth.server` and `@carbon/database` are used everywhere.

- If an internal file moves, re-export from the old path with `@deprecated` JSDoc
- Keep the re-export for at least one release cycle

### Model Validators (Zod) — STABLE

Zod schemas in `{module}.models.ts` define form validation and API contracts.

- Add new optional fields freely
- Never remove a required field without making it optional first
- Never change validation rules in a way that rejects previously valid input

## Deprecation Protocol

When a STABLE surface must change:

1. **Never remove in a single release**
2. **Add `@deprecated` JSDoc** with migration guidance and target removal date
3. **Provide a bridge** (re-export, alias, accept old format) for at least one minor version
4. **Update all internal callers** before deprecating
5. **Document the change** in the spec and/or PR description

## How This Applies to AI Agents

When an AI agent generates code:
- Read this contract before renaming, removing, or restructuring anything
- If a change touches a FROZEN surface, **stop and ask the human**
- If a change touches a STABLE surface, follow the deprecation protocol
- If adding new things to an ADDITIVE-ONLY surface, proceed freely
- When in doubt, add new rather than modify existing
