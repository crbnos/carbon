---
paths: ["apps/erp/app/modules/*/*.models.ts", "apps/mes/app/services/models.ts"]
triggers: [".refine("]
promoted: null
---
# A zod `.refine` that returns an object instead of a boolean silently disables the check

**Context:** Cross-field validation in module `*.models.ts` zod schemas (real case: `processValidator` in `apps/erp/app/modules/resources/resources.models.ts`, lines 305–319).

**Problem:** `.refine((data) => { if (bad) return { workCenters: ["..."] }; return true; })` looks like it reports a field error, but `.refine`'s callback is coerced to a boolean — any non-empty object is **truthy**, so the "failure" branch returns a value that passes validation. Both `processValidator` refinements (work-center-required and standard-factor-required) never fire: the object was meant to be an error map, but `.refine` has no such API. The schema typechecks and the form submits, so the missing validation is invisible until bad data lands.

**Rule:** A `.refine` predicate must return a **boolean** (`false` = invalid). To attach a path/message, either pass the second `{ message, path }` argument to `.refine` and return `false` on failure, or use `.superRefine((data, ctx) => ctx.addIssue({ path, message }))` when you need per-field errors. Never return an object/array from a `.refine` callback expecting it to be an error map.

**Applies to:** all `apps/erp/app/modules/**/*.models.ts` (and `apps/mes/app/services/models.ts`) zod schemas using `.refine`.
