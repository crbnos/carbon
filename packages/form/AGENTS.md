# @carbon/form

Form system — `ValidatedForm`, field components, validation helpers, and server-side utilities for zod + FormData workflows.

## Always

- **Validators use `zod` + `zod-form-data`** (`z` from `"zod"`, `zfd` from `"zod-form-data"`). There is no `@carbon/form` schema helper — schemas are plain zod.
- **Pass raw zod schema to `ValidatedForm`** via `validator={mySchema}`. The `validator()` wrapper is only used in route actions: `validator(schema).request(args, …)` (legacy: `validator(schema).validate(formData)`).
- **Import fields from `~/components/Form`** in apps (barrel re-exports all `@carbon/form` fields + domain selectors). Never import deep paths from `@carbon/form/src/components/...`.
- **Include `<Hidden name="id" />` and `<CustomFormFields table="..." />`** in edit forms. Type form props with `z.infer<typeof validator>`.
- **Route action pattern**: check the request first with `validator(schema?).request(args, { method?, params? })`: the method (default POST, else a 405), the named route params (a 400), then the body (form data or JSON). It returns `{ data, params, formData }` or `{ invalid }` (the `validationError` to return). Without a schema it reads no body. Then make one service-function call through `carbon(request)` and return its result (see `.claude/rules/conventions-forms.md`).
- **Legacy actions** (not yet migrated) run `assertIsPost` → `requirePermissions` → `validator(schema).validate(formData)` → service call → `flash`/`redirect`, returning `validationError(validation.error)` on failure. Do not write new ones.

## Ask First

- Adding new field components to `src/components/`
- Changing `ValidatedForm` props or internal state management
- Modifying the `server.ts` exports (`validationError`, `validator`)

## Never

- Use `json()` in route actions — use `data(value, init)` instead (Remix `json` helper is deprecated)
- Use `schema.parse()` or `schema.safeParse()` in actions — use `validator(schema).request(args)`
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
import { validator } from "@carbon/form";
const input = await validator(thingValidator).request(args, { params: ["thingId"] });
if ("invalid" in input) return input.invalid;
const api = await carbon(args.request); // @carbon/api/carbon.server
return api.things.updateThing({ ...input.data, id: input.params.thingId });
```

## Available Field Components

`Input`, `Number`, `Select`, `Combobox`, `CreatableCombobox`, `MultiSelect`, `Boolean`, `TextArea`, `DatePicker`, `DateTimePicker`, `TimePicker`, `Timezone`, `Hidden`, `Password`, `PhoneInput`, `Radios`, `Array`, `Submit` — plus `*Controlled` variants for `Input`, `Number`, `Select`, `TextArea`.

## Cross-References

- `.claude/rules/conventions-forms.md` — full forms conventions, validator rules, action patterns, checklist
- `@carbon/react` — layout and overlay components (`ModalDrawer`, `VStack`, `Button`)
- `apps/erp/app/components/Form/` — domain selectors (Customer, Employee, Item, Location, etc.)
