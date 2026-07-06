# Carbon Conventions

Quick reference for all Carbon-specific patterns. Load the relevant file before writing code.

| Convention | File | When to Load |
|------------|------|--------------|
| Database | [database.md](database.md) | Migrations, RLS, multi-tenancy, transactions |
| Forms | [forms.md](forms.md) | ValidatedForm, zod validators, route actions |
| Services | [services.md](services.md) | Service functions, upserts, error handling |
| UI | [ui.md](ui.md) | Components, animations, polish |

## The Golden Rules

1. **Multi-tenancy**: Every table has `companyId` with composite PK `("id", "companyId")`
2. **IDs**: Use `id('prefix')` function, never UUID directly
3. **Audit**: Include `createdBy`, `createdAt`, `updatedBy`, `updatedAt`
4. **RLS**: Standardized policy names: SELECT, INSERT, UPDATE, DELETE
5. **Forms**: `ValidatedForm` + zod validator + route action
6. **Transactions**: Use Kysely for multi-row writes, not Promise.all
7. **Errors**: Use `flash(request, error(...))` pattern, throw redirects on success
