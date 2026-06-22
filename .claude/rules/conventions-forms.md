---
paths:
  - "apps/erp/app/modules/**/ui/**"
  - "apps/erp/app/modules/**/*.models.ts"
  - "apps/erp/app/components/Form/**"
  - "apps/mes/app/components/**"
  - "packages/form/**"
---

# Forms Conventions

Forms in Carbon follow a three-part pattern: **zod validator** (module `.models.ts`)
→ **form component** (`ValidatedForm` in `ui/`) → **route action** (validate +
service call + redirect). This rule is the full detail; it aligns with the `forms`
skill (`.claude/skills/forms/SKILL.md`) — don't contradict it.

Real reference examples (current code):

- `apps/erp/app/modules/accounting/ui/PaymentTerms/PaymentTermForm.tsx` + route
  actions `apps/erp/app/routes/x+/accounting+/payment-terms.new.tsx` (create) and
  `payment-terms.$paymentTermId.tsx` (edit).
- `apps/erp/app/modules/resources/ui/WorkCenters/WorkCenterForm.tsx` +
  `apps/erp/app/routes/x+/resources+/work-centers.new.tsx`.
- `apps/erp/app/modules/storage-rules/ui/StorageRuleForm.tsx` (uses `.superRefine`,
  `zfd.checkbox`, `zfd.repeatableOfType`).

## File Locations

| Piece | ERP Location | MES Location |
|-------|-------------|-------------|
| Validator | `app/modules/{module}/{module}.models.ts` | `app/services/models.ts` |
| Form UI | `app/modules/{module}/ui/{Feature}/{Feature}Form.tsx` | Inline in route or `app/components/` |
| Create action | `app/routes/x+/{module}+/{resource}.new.tsx` | `app/routes/x+/{resource}.tsx` |
| Edit action | `app/routes/x+/{module}+/{resource}.${id}.tsx` | same route |
| Form fields | `~/components/Form` (re-exports `@carbon/form` + domain selectors) | `@carbon/form` directly |

Import fields from the barrel `~/components/Form`, not deep `@carbon/form` paths.
The barrel re-exports every base field from `@carbon/form` plus the ERP domain
selectors (`apps/erp/app/components/Form/index.ts`).

## 1. Validator (zod schema)

Define in the module's `.models.ts`. **Import is `import { z } from "zod"` and
`import { zfd } from "zod-form-data"`** — there is NO `@carbon/form` schema helper;
the schema is plain zod. Use `zfd` to coerce raw `FormData` strings into the right
types.

```typescript
import { z } from "zod";
import { zfd } from "zod-form-data";

export const thingValidator = z.object({
  id: zfd.text(z.string().optional()),               // optional id (create vs edit)
  name: z.string().min(1, { message: "Name is required" }),
  type: z.enum(thingTypes, {                          // enum with custom message
    errorMap: () => ({ message: "Type is required" })
  }),
  quantity: zfd.numeric(z.number().min(0)),           // number from FormData
  isActive: zfd.checkbox(),                           // checkbox boolean
  notes: zfd.text(z.string().optional()),             // optional text
  tags: zfd.repeatableOfType(z.string()).optional(),  // repeated form field → array
});
```

### Validator rules

| Field type | Use |
|------------|-----|
| Optional string | `zfd.text(z.string().optional())` |
| Number from FormData | `zfd.numeric(z.number())` |
| Checkbox boolean | `zfd.checkbox()` |
| Repeated field → array | `zfd.repeatableOfType(z.string())` |
| Enum | `z.enum(values, { errorMap: () => ({ message }) })` |
| Required array | `z.array(z.string().min(1)).min(1, { message })` |
| Cross-field | `.refine()` / `.superRefine()` on the object |

## 2. Form Component

The core is `ValidatedForm` wrapping the fields. The **`validator` prop takes the
raw zod schema directly** (e.g. `validator={thingValidator}`), NOT a wrapped
validator — wrapping with `validator(schema)` happens only in the route action.

Real forms typically: wrap in a `ModalDrawer*` container (`@carbon/react`), pass a
`useFetcher()` to the form, set `className="flex flex-col h-full"`, and use Lingui
``t`...` `` for labels. Containers vary (Drawer, Modal, Card, inline) — match
neighboring routes.

```typescript
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { thingValidator } from "~/modules/things";
import { path } from "~/utils/path";

type ThingFormProps = {
  initialValues: z.infer<typeof thingValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const ThingForm = ({ initialValues, type = "drawer", open, onClose }: ThingFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "things")
    : !permissions.can("create", "things");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
        <ModalDrawerContent>
          <ValidatedForm
            validator={thingValidator}
            method="post"
            action={isEditing ? path.to.thing(initialValues.id!) : path.to.newThing}
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>{isEditing ? t`Edit Thing` : t`New Thing`}</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Select name="type" label={t`Type`} options={typeOptions} />
                <CustomFormFields table="thing" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>{t`Save`}</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  {t`Cancel`}
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};
```

### Form component rules

- Type props with `z.infer<typeof validator>`.
- `validator={rawZodSchema}` — pass the schema directly.
- Include `<Hidden name="id" />` for edit support; `<Hidden name="type" value={type} />`
  when the action branches on `modal` vs page submission.
- `<CustomFormFields table="{tableName}" />` renders per-table custom fields.
- `VStack spacing={4}` for vertical layout; `grid grid-cols-1 lg:grid-cols-3
  gap-x-8 gap-y-4` for multi-column.
- Permission check drives `isDisabled` on `<Submit>`.
- Pass `fetcher` from `useFetcher()` when the form is a drawer/modal (so loading
  state and action data flow through the fetcher); plain page forms may omit it.

## 3. Route Action

```typescript
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { data, redirect } from "react-router";
import { thingValidator, upsertThing } from "~/modules/things";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "things"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(thingValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...rest } = validation.data;

  const insertThing = await upsertThing(client, {
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (insertThing.error) {
    return data(
      {},
      await flash(request, error(insertThing.error, "Failed to create thing"))
    );
  }

  // Modal flows often return the created row (status 201) instead of redirecting,
  // so the opener can read it; page flows throw a redirect.
  return modal
    ? data(insertThing, { status: 201 })
    : redirect(
        `${path.to.things}?${getParams(request)}`,
        await flash(request, success("Thing created"))
      );
}
```

### Route action rules

| Step | Pattern |
|------|---------|
| First | `assertIsPost(request)` |
| Auth | `requirePermissions(request, { create \| update: "module" })` → `{ client, companyId, userId }` |
| Read once | `const formData = await request.formData()` (reuse it; check `modal` via `formData.get("type")`) |
| Validate | `validator(thingValidator).validate(formData)` — the **only** place the schema gets wrapped with `validator(...)`; NOT `schema.parse()` |
| Validation error | `return validationError(validation.error)` (422; from `@carbon/form`) |
| Custom fields | `customFields: setCustomFields(formData)` (`~/utils/form`) |
| Service error | `return data({}, await flash(request, error(...)))` |
| Success (page) | `throw redirect(...)` — NOT `return redirect()` (some modal branches `return redirect(...)` / `return data(row, { status: 201 })`) |

Actions return **plain objects** or `data(value, init)`. Do NOT use `json(...)` —
that is the old Remix helper and is not used here. Edit actions live in the
`${id}` route and use `update: "module"` permission instead of `create`.

## 4. Route Default Export

Page (non-modal) routes export a default component that renders the form:

```typescript
export default function NewThingRoute() {
  const initialValues = { name: "", type: "Default" as const };
  return <ThingForm initialValues={initialValues} />;
}
```

Edit routes load data in the loader and pass it through:

```typescript
export default function EditThingRoute() {
  const { thing } = useLoaderData<typeof loader>();
  return <ThingForm initialValues={thing} />;
}
```

Drawer/modal forms are often rendered by a parent list route instead of having
their own default export; the route file may then be action-only.

## Available Form Components

### Base fields (`@carbon/form`, re-exported by `~/components/Form`)

Source: `packages/form/src/components/`.

| Component | Notable props | Use for |
|-----------|---------------|---------|
| `Input` / `InputControlled` | `name, label, prefix?, suffix?` | Text |
| `Number` / `NumberControlled` | `name, label, formatOptions?, minValue?, maxValue?` | Numeric with steppers |
| `TextArea` / `TextAreaControlled` | `name, label` | Multi-line |
| `Select` / `SelectControlled` | `name, label, options: {label,value}[]` | Dropdown |
| `Combobox` | `name, label, options` | Searchable dropdown |
| `CreatableCombobox` | `name, label, options, onCreateOption?` | Searchable + create |
| `MultiSelect` / `CreatableMultiSelect` | `name, label, options` | Multi-select |
| `Boolean` | `name, label, description?` | Switch/toggle |
| `Radios` | `name, label, options` | Radio buttons |
| `DatePicker` / `DateTimePicker` / `TimePicker` | `name, label` | Date / time |
| `Timezone` | `name, label` | Timezone select |
| `Hidden` | `name, value?` | Hidden field |
| `Password` | `name, label` | Password with toggle |
| `PhoneInput` | `name, label` | Phone |
| `InputOTP` | `name` | OTP code |
| `Array` / `ArrayNumeric` | `name, label` | Dynamic list fields |
| `Submit` / `DefaultDisabledSubmit` | `isDisabled?, withBlocker?` | Submit button |
| `ChoiceCardGroup` | `options` | Card-style choice group |

### Domain selectors (`~/components/Form` only)

Combobox/CreatableCombobox wrappers that auto-load options from stores — use these
instead of a raw `Combobox` when the entity matches. Current set
(`apps/erp/app/components/Form/index.ts`):

`Abilities`, `Ability`, `Account` (+`AccountControlled`), `AddressAutocomplete`,
`AssetClass`, `Color`, `ConversionFactor`, `CostCenter`, `Currency`, `Customer`,
`CustomerContact`, `CustomerLocation`, `CustomerStatus`, `Customers`,
`CustomerType`, `CustomerTypes`, `CustomFormFields`, `DefaultMethodType`,
`Department`, `EmailRecipients`, `EmojiPicker`, `Employee`, `Employees`, `Item`,
`ItemPostingGroup`, `Items`, `Location`, `MaterialType`, `Part`, `PaymentTerm`,
`Procedure`, `Process`, `Processes`, `Sequence`, `SequenceOrCustomId`, `Service`,
`ShelfLifeStartProcess`, `ShelfLifeStartTiming`, `Shift`, `ShippingMethod`,
`StandardFactor`, `StorageTypes`, `StorageUnit`, `Supplier`, `SupplierContact`,
`SupplierLocation`, `SupplierProcess`, `SupplierStatus`, `Suppliers`,
`SupplierType`, `Tags`, `Tool`, `UnitHint`, `UnitOfMeasure`, `User`, `Users`,
`WorkCenter`, `WorkCenters`.

## Common Patterns

### Dependent fields

```typescript
const [categoryId, setCategoryId] = useState(initialValues.categoryId ?? "");

<AccountCategory name="categoryId" onChange={(cat) => setCategoryId(cat?.id ?? "")} />
<AccountSubcategory name="subcategoryId" accountCategoryId={categoryId} />
```
<!-- UNVERIFIED: AccountCategory/AccountSubcategory selectors not present in the
current `~/components/Form/index.ts` export list; pattern shape is correct but
those exact component names may have changed. -->

### Enum options from const array

```typescript
const typeOptions = thingTypes.map((t) => ({ label: t, value: t }));
<Select name="type" label="Type" options={typeOptions} />
```

### Client action (cache invalidation)

Cached entities add a `clientAction` that clears/invalidates the company-scoped
query, then delegates. Two shapes are both in use:

```typescript
// Clear a specific cached query (most common for these list queries)
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(thingsQuery(getCompanyId()).queryKey, null);
  return await serverAction();
}

// Or invalidate by predicate on a company-scoped key
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

- [ ] Zod validator in `{module}.models.ts` (`import { z } from "zod"` + `zfd`)
- [ ] Validator exported from the module `index.ts` barrel
- [ ] Form component with `ValidatedForm`, raw schema in `validator` prop
- [ ] Props typed with `z.infer<typeof validator>`; `<Hidden name="id" />` present
- [ ] Route action: `assertIsPost` → `requirePermissions` →
      `validator(schema).validate(formData)` → service → flash/redirect
- [ ] `setCustomFields(formData)` + `<CustomFormFields table="..." />` if the
      table has custom fields
- [ ] `clientAction` if the entity is cached client-side
- [ ] Path helpers in `~/utils/path` (use `path.to.*`, never hardcoded URLs)
- [ ] Container matches neighboring routes (ModalDrawer, Card, inline, etc.)
