# @carbon/form

Form system — `ValidatedForm`, field components, validation helpers, and server-side utilities for zod + FormData workflows.

## Always

- **Validators use `zod` + `zod-form-data`** (`z` from `"zod"`, `zfd` from `"zod-form-data"`). There is no `@carbon/form` schema helper — schemas are plain zod.
- **Pass raw zod schema to `ValidatedForm`** via `validator={mySchema}`. The `validator()` wrapper is only used in route actions: `validator(schema).validate(formData)`.
- **Import fields from `~/components/Form`** in apps (barrel re-exports all `@carbon/form` fields + domain selectors). Never import deep paths from `@carbon/form/src/components/...`.
- **Include `<Hidden name="id" />` and `<CustomFormFields table="..." />`** in edit forms. Type form props with `z.infer<typeof validator>`.
- **Route action pattern**: `assertIsPost` → `requirePermissions` → `validator(schema).validate(formData)` → service call → `flash`/`redirect`. Return `validationError(validation.error)` on failure.

## Ask First

- Adding new field components to `src/components/`
- Changing `ValidatedForm` props or internal state management
- Modifying the `server.ts` exports (`validationError`, `validator`)

## Never

- Use `json()` in route actions — use `data(value, init)` instead (Remix `json` helper is deprecated)
- Use `schema.parse()` or `schema.safeParse()` in actions — use `validator(schema).validate(formData)`
- Import `{ t }` from `@lingui/core/macro` — use `useLingui` from `@lingui/react/macro` in components

## Validation Commands

```bash
pnpm --filter @carbon/form typecheck
pnpm --filter @carbon/form test
pnpm --filter @carbon/form lint
```

## Key Patterns

```typescript
// Validator (in module .models.ts)
import { z } from "zod";
import { zfd } from "zod-form-data";
export const thingValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  quantity: zfd.numeric(z.number().min(0)),
  isActive: zfd.checkbox(),
});

// Form component
import { ValidatedForm } from "@carbon/form";
import { Hidden, Input, Number, Submit } from "~/components/Form";
<ValidatedForm validator={thingValidator} method="post" action={path} fetcher={fetcher}>

// Route action
import { validationError, validator } from "@carbon/form";
const validation = await validator(thingValidator).validate(formData);
if (validation.error) return validationError(validation.error);
```

## Available Field Components

`Input`, `Number`, `Select`, `Combobox`, `CreatableCombobox`, `MultiSelect`, `Boolean`, `TextArea`, `DatePicker`, `DateTimePicker`, `TimePicker`, `Timezone`, `Hidden`, `Password`, `PhoneInput`, `Radios`, `Array`, `Submit` — plus `*Controlled` variants for `Input`, `Number`, `Select`, `TextArea`.

## Cross-References

- `.claude/rules/conventions-forms.md` — full forms conventions, validator rules, action patterns, checklist
- `@carbon/react` — layout and overlay components (`ModalDrawer`, `VStack`, `Button`)
- `apps/erp/app/components/Form/` — domain selectors (Customer, Employee, Item, Location, etc.)
