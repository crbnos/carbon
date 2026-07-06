# Forms Conventions

Forms in Carbon follow a three-part pattern: **zod validator** → **form component** → **route action**.

## File Locations

| Piece | ERP Location |
|-------|-------------|
| Validator | `app/modules/{module}/{module}.models.ts` |
| Form UI | `app/modules/{module}/ui/{Feature}/{Feature}Form.tsx` |
| Route action | `app/routes/x+/{module}+/{resource}.new.tsx` |
| Components | `~/components/Form` (re-exports `@carbon/form` + selectors) |

## 1. Validator

Define in module's `.models.ts`:

```typescript
import { z } from "zod";
import { zfd } from "zod-form-data";

export const thingValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  type: z.enum(thingTypes, {
    errorMap: () => ({ message: "Type is required" })
  }),
  quantity: zfd.numeric(z.number().min(0)),
  isActive: zfd.checkbox(),
  notes: zfd.text(z.string().optional()),
  items: z.array(z.string().min(1)).min(1, {
    message: "At least one item is required"
  }),
});
```

### Validator Rules

| Field Type | Use |
|------------|-----|
| Optional string | `zfd.text(z.string().optional())` |
| Number from FormData | `zfd.numeric(z.number())` |
| Checkbox boolean | `zfd.checkbox()` |
| Enum | `z.enum(values, { errorMap: ... })` |
| Cross-field | `.refine()` |

## 2. Form Component

```typescript
import { ValidatedForm } from "@carbon/form";
import { Button, HStack, VStack } from "@carbon/react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { thingValidator } from "~/modules/things";
import { path } from "~/utils/path";

type ThingFormProps = {
  initialValues: z.infer<typeof thingValidator>;
};

const ThingForm = ({ initialValues }: ThingFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isEditing = !!initialValues.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "things")
    : !permissions.can("create", "things");

  return (
    <ValidatedForm
      validator={thingValidator}
      method="post"
      action={isEditing ? path.to.thing(initialValues.id!) : path.to.newThing}
      defaultValues={initialValues}
    >
      <Hidden name="id" />
      <VStack spacing={4}>
        <Input name="name" label="Name" />
        <Select name="type" label="Type" options={typeOptions} />
      </VStack>
      <HStack>
        <Submit isDisabled={isDisabled}>Save</Submit>
        <Button size="md" variant="solid" onClick={onClose}>Cancel</Button>
      </HStack>
    </ValidatedForm>
  );
};
```

### Form Component Rules

- Always include `<Hidden name="id" />` for edit support
- Use `VStack spacing={4}` for vertical layout
- Use `grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4` for multi-column
- Permission check determines `isDisabled` on Submit
- Type props with `z.infer<typeof validator>`

## 3. Route Action

```typescript
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { thingValidator, insertThing } from "~/modules/things";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "things"
  });

  const validation = await validator(thingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await insertThing(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data({}, await flash(request, error(result.error, "Failed to create")));
  }

  throw redirect(path.to.things, await flash(request, success("Created")));
}
```

### Route Action Rules

| Step | Pattern |
|------|---------|
| First | `assertIsPost(request)` |
| Auth | `requirePermissions(request, { action: "module" })` |
| Validate | `validator(schema).validate(formData)` — NOT `schema.parse()` |
| Validation error | `return validationError(validation.error)` |
| Service error | `return data({}, await flash(request, error(...)))` |
| Success | `throw redirect(...)` — NOT `return redirect()` |

## Available Components

### Base (`@carbon/form`)

| Component | Props | Use For |
|-----------|-------|---------|
| `Input` | `name, label, prefix?, suffix?` | Text |
| `Number` | `name, label, formatOptions?` | Numeric with steppers |
| `TextArea` | `name, label, characterLimit?` | Multi-line |
| `Select` | `name, label, options` | Dropdown |
| `Combobox` | `name, label, options` | Searchable dropdown |
| `CreatableCombobox` | `name, label, options, onCreateOption?` | Searchable + create |
| `MultiSelect` | `name, label, options` | Multi-select |
| `Boolean` | `name, label, description?` | Toggle |
| `DatePicker` | `name, label` | Date |
| `Hidden` | `name, value?` | Hidden field |
| `Submit` | `isDisabled?` | Submit button |

### Domain Selectors (`~/components/Form`)

Auto-load options from stores:

`Customer`, `Supplier`, `Employee`, `Item`, `Part`, `Location`, `Account`, `Currency`, `Department`, `WorkCenter`, `UnitOfMeasure`, `PaymentTerm`, `ShippingMethod`, `Tags`

## Common Patterns

### Dependent Fields

```typescript
const [categoryId, setCategoryId] = useState(initialValues.categoryId ?? "");

<AccountCategory name="categoryId" onChange={(cat) => setCategoryId(cat?.id ?? "")} />
<AccountSubcategory name="subcategoryId" accountCategoryId={categoryId} />
```

### Enum Options

```typescript
const typeOptions = thingTypes.map((t) => ({ label: t, value: t }));
<Select name="type" label="Type" options={typeOptions} />
```

### Client Action (Cache Invalidation)

```typescript
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();
  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return queryKey[0] === "things" && queryKey[1] === companyId;
    }
  });
  return await serverAction();
}
```

## Checklist

- [ ] Zod validator in `{module}.models.ts`
- [ ] Validator exported from module index
- [ ] Form component with `ValidatedForm`
- [ ] Route with action + default export
- [ ] `clientAction` if entity is cached
- [ ] Path helpers in `~/utils/path`
- [ ] Container matches neighboring routes (Drawer, Card, etc.)
