---
paths: []
triggers: []
promoted: null
---
# ValidatedForm needs the validator, not the raw schema

**Context:** Building forms with zod validation.

**Problem:** Passing a raw zod schema to `ValidatedForm` instead of wrapping it with `validator()` from `@carbon/form` results in silent validation failures — the form submits without client-side validation.

**Rule:** Always use `validator(schema)` from `@carbon/form`, not the raw zod schema. Validate with `validator(schema).validate(formData)`, not `schema.parse()`.

**Applies to:** All forms in `apps/erp/app/routes/`, `packages/form/`.
