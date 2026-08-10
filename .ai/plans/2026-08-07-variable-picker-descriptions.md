# Variable picker descriptions — implementation plan

**Source:** user description  
**Branch:** feat/automation

## Progress
- [x] Task 1: Add `describe` to `RegistryEntry` in `build.ts`
- [x] Task 2: Add `descriptions` to `CatalogEntity` in `definition/catalog.ts`
- [x] Task 3: Populate descriptions at runtime in `catalog.ts`
- [x] Task 4: Thread `description` into `VariableTreeNode` in `variableMenu.ts`
- [x] Task 5: Render description tooltip in `VariableTreeMenu.tsx`
- [x] Task 6: Add `describe` to `EntityEntry` in `entities.ts` and write all descriptions
- [ ] Task 7: Typecheck, biome, catalog check

## Dependencies
Tasks 1–2 are independent. Task 3 depends on 1+2. Task 4 depends on 2. Task 5 depends on 4. Task 6 depends on 1. Task 7 depends on all.

---

## Task 1: Add `describe` to `RegistryEntry` in `build.ts`

**Depends on:** none  
**Files:**
- Modify: `packages/workflows/src/catalog/build.ts`

**Steps:**

1. Add `describe?: Record<string, string>` to `WatchedColumnLike` (not here — see note) and to `RegistryEntry`:

In `RegistryEntry`, after the `write?` line, add:
```ts
/** Plain-English explanation per column, surfaced as a tooltip in the variable picker.
 * Any column in the entity may have one; not restricted to watched or writable columns. */
describe?: Record<string, string>;
```

That is the only change to `build.ts` — no change to `buildCatalog()` or `BuiltCatalog`, because descriptions bypass the generator and are read directly from `REGISTRY_ENTRIES` at runtime (see Task 3).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: 0 errors
```

---

## Task 2: Add `descriptions` to `CatalogEntity` in `definition/catalog.ts`

**Depends on:** none  
**Files:**
- Modify: `packages/workflows/src/definition/catalog.ts`

**Steps:**

1. In `CatalogEntity`, add after the `permission?` line:
```ts
/** Plain-English per-column description, keyed by column name.
 * Only present for columns the registry explicitly describes. */
descriptions?: Record<string, string>;
```

No other changes to this file — `WorkflowCatalog`, fixture data, and `walkPath` are untouched.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: 0 errors
```

---

## Task 3: Populate descriptions at runtime in `catalog.ts`

**Depends on:** Task 1, Task 2  
**Files:**
- Modify: `packages/workflows/src/catalog/catalog.ts`

**Steps:**

1. In the `ENTITIES` map build (lines 24–34), merge `REGISTRY_ENTRIES[name]?.describe` into each entity:

Replace:
```ts
const ENTITIES: Map<string, CatalogEntity> = new Map(
  Object.entries(WORKFLOW_ENTITIES).map(([name, properties]) => {
    const module = REGISTRY_ENTRIES[name]?.permission;
    return [
      name,
      module === undefined
        ? { name, properties }
        : { name, properties, permission: { module, action: "view" as const } }
    ];
  })
);
```

With:
```ts
const ENTITIES: Map<string, CatalogEntity> = new Map(
  Object.entries(WORKFLOW_ENTITIES).map(([name, properties]) => {
    const entry = REGISTRY_ENTRIES[name];
    const base: CatalogEntity = { name, properties };
    if (entry?.permission !== undefined)
      base.permission = { module: entry.permission, action: "view" };
    if (entry?.describe !== undefined) base.descriptions = entry.describe;
    return [name, base];
  })
);
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: 0 errors
```

---

## Task 4: Thread `description` into `VariableTreeNode` in `variableMenu.ts`

**Depends on:** Task 2  
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/variableMenu.ts`

**Steps:**

1. Add `description?: string` to `VariableTreeNode`:
```ts
export type VariableTreeNode = {
  key: string;
  label: string;
  helper?: string;
  description?: string;   // ← add
  item?: VariableMenuItem;
  children?: VariableTreeNode[];
};
```

2. In `variableTree()`, add `description?: string` parameter to the inner `build()` function signature (after `label: string`) and set it on the node:

```ts
function build(
  variable: AvailableVariable,
  type: ValueType,
  path: string[],
  label: string,
  description?: string   // ← add
): VariableTreeNode | null {
  ...
  const node: VariableTreeNode = {
    key: `${variable.nodeId}:${variable.output}:${path.join(".")}`,
    label,
    helper,
    description,           // ← add
    item: compatible ? { ... } : undefined
  };
```

3. In the entity property expansion inside `build()` (the `Object.entries(entity.properties).map(...)` call), pass the description from `entity.descriptions`:

```ts
const children = entity
  ? Object.entries(entity.properties)
      .map(([property, propertyType]) =>
        build(
          variable,
          propertyType,
          [...path, property],
          labelFor(propertyLabelKey(type.of, property), property),
          entity.descriptions?.[property]   // ← add
        )
      )
      .filter((child): child is VariableTreeNode => child !== null)
  : [];
```

No changes to `variableMenuItems()` — flat items don't show tooltips.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

---

## Task 5: Render description tooltip in `VariableTreeMenu.tsx`

**Depends on:** Task 4  
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/VariableTreeMenu.tsx`
- Precedent: `apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx` (Tooltip usage)

**Steps:**

1. Add `Tooltip`, `TooltipContent`, `TooltipTrigger` to the `@carbon/react` import:
```ts
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
```

2. Also add `LuInfo` to the react-icons import:
```ts
import { LuArrowLeft, LuChevronRight, LuInfo } from "react-icons/lu";
```

3. In the row render, wrap the label+helper span with `Tooltip` when `row.description` is set. Replace:

```tsx
<span className="flex min-w-0 flex-1 flex-col">
  <span className="truncate leading-tight">{row.label}</span>
  {row.helper && (
    <span className="truncate text-xs leading-tight text-muted-foreground">
      {row.helper}
    </span>
  )}
</span>
```

With:

```tsx
<span className="flex min-w-0 flex-1 flex-col">
  <span className="flex items-center gap-1 leading-tight">
    <span className="truncate">{row.label}</span>
    {row.description && (
      <Tooltip>
        <TooltipTrigger asChild>
          <LuInfo className="h-3 w-3 shrink-0 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-wrap">
          {row.description}
        </TooltipContent>
      </Tooltip>
    )}
  </span>
  {row.helper && (
    <span className="truncate text-xs leading-tight text-muted-foreground">
      {row.helper}
    </span>
  )}
</span>
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
pnpm exec biome check apps/erp/app/modules/workflows/ui/Builder/fields/VariableTreeMenu.tsx
# Expected: no errors
```

---

## Task 6: Add `describe` to `EntityEntry` and write descriptions in `entities.ts`

**Depends on:** Task 1  
**Files:**
- Modify: `packages/workflows/src/catalog/entities.ts`

**Steps:**

1. Add `describe?: { [C in ColumnOf<T>]?: string }` to `EntityEntry<T>`:
```ts
interface EntityEntry<T extends TableName>
  extends Omit<RegistryEntry, "table" | "watch" | "write" | "describe"> {
  table: T;
  watch?: { [C in ColumnOf<T>]?: WatchedColumnLike };
  write?: { [C in ColumnOf<T>]?: WritableColumnLike };
  describe?: { [C in ColumnOf<T>]?: string };
}
```

2. Add `describe` blocks to the ten triggerable entities. Write a plain one-liner per column that covers what the field holds or what the user should enter. Focus on columns users will commonly see in the picker. Below is the full set — copy verbatim into each entity in `WORKFLOW_ENTITY_REGISTRY`:

**purchaseOrder**
```ts
describe: {
  status: "Current state of the purchase order (Draft, Submitted, etc.)",
  supplierId: "The supplier this purchase order is placed with",
  assignee: "Person responsible for managing this purchase order",
  orderDate: "The date the order was placed",
  purchaseOrderType: "Whether this is a purchase order or blanket order",
  supplierReference: "The supplier's own reference number for this order",
  supplierLocationId: "The supplier's location this order is sent to",
  tags: "Labels attached to this purchase order for filtering",
  receiptDate: "The date goods are expected to be received",
  notes: "Internal notes about this purchase order"
}
```

**salesOrder**
```ts
describe: {
  status: "Current state of the sales order",
  customerId: "The customer this sales order belongs to",
  assignee: "Person responsible for this sales order",
  salesPersonId: "The salesperson handling this order",
  orderDate: "The date the order was created",
  locationId: "The warehouse or location fulfilling this order",
  customerReference: "The customer's own reference or PO number",
  completedDate: "The date this order was completed"
}
```

**job**
```ts
describe: {
  status: "Current state of the job (Draft, In Progress, etc.)",
  assignee: "Person responsible for this production job",
  dueDate: "When this job must be completed",
  startDate: "When work on this job should begin",
  quantity: "The number of units to produce",
  priority: "Urgency level — higher number means higher priority",
  deadlineType: "Whether the due date is a hard or soft deadline",
  scrapQuantity: "Units scrapped during production"
}
```

**item**
```ts
describe: {
  active: "Whether this item is currently active and usable",
  revisionStatus: "The current revision lifecycle stage",
  replenishmentSystem: "How stock is replenished — Buy, Make, or Transfer",
  itemTrackingType: "Whether the item is tracked by lot, serial number, or not at all",
  defaultMethodType: "Default costing method for this item",
  assignee: "Person responsible for maintaining this item",
  name: "The display name of this item",
  unitOfMeasureCode: "The unit this item is measured and ordered in"
}
```

**receipt**
```ts
describe: {
  status: "Current state of the receipt (Draft, Posted, etc.)",
  supplierId: "The supplier the goods were received from",
  locationId: "The warehouse location where goods were received",
  assignee: "Person responsible for this receipt",
  postingDate: "The date this receipt was posted to inventory",
  invoiced: "Whether this receipt has been matched to a supplier invoice",
  sourceDocument: "The purchase order or other document this receipt came from"
}
```

**shipment**
```ts
describe: {
  status: "Current state of the shipment",
  customerId: "The customer this shipment is going to",
  locationId: "The warehouse location the goods are shipping from",
  assignee: "Person responsible for this shipment",
  postingDate: "The date this shipment was posted",
  trackingNumber: "Carrier tracking number for this shipment",
  shippingMethodId: "The shipping carrier or method used"
}
```

**quote**
```ts
describe: {
  status: "Current state of the quote",
  customerId: "The customer this quote is for",
  assignee: "Person managing this quote",
  estimatorId: "The person who estimated the costs",
  salesPersonId: "The salesperson responsible for this quote",
  expirationDate: "Date after which this quote is no longer valid",
  dueDate: "When the customer needs a response",
  completedDate: "The date this quote was won or lost"
}
```

**supplier**
```ts
describe: {
  supplierStatus: "Current status of the supplier relationship",
  supplierTypeId: "The category or type of supplier",
  accountManagerId: "Internal person managing the supplier relationship",
  assignee: "Person primarily responsible for this supplier",
  name: "The supplier's display name",
  currencyCode: "The currency used when purchasing from this supplier",
  taxPercent: "Default tax rate applied to purchases from this supplier"
}
```

**customer**
```ts
describe: {
  customerStatusId: "Current status of the customer relationship",
  customerTypeId: "The category or type of customer",
  accountManagerId: "Internal person managing the customer account",
  assignee: "Person primarily responsible for this customer",
  name: "The customer's display name",
  currencyCode: "The currency used when selling to this customer",
  salesContactId: "The main sales contact at this customer"
}
```

**nonConformance**
```ts
describe: {
  status: "Current state of the issue (Open, Under Review, Closed, etc.)",
  priority: "How urgently this issue needs to be resolved",
  assignee: "Person responsible for resolving this issue",
  source: "Where the issue was discovered (Production, Receiving, etc.)",
  nonConformanceTypeId: "The type or category of this issue",
  dueDate: "When this issue must be resolved",
  closeDate: "The date this issue was closed",
  locationId: "Location where the issue was found",
  quantity: "Quantity of units affected by this issue"
}
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: 0 errors — any typo in a column name fails here because ColumnOf<T> catches it
```

---

## Task 7: Typecheck, biome, and catalog check

**Depends on:** Tasks 1–6  
**Files:** none

**Steps:**

```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=erp
pnpm exec biome check packages/workflows/src/ apps/erp/app/modules/workflows/
pnpm run check:workflow-catalog
```

**Expected:**
- typecheck: 0 errors for both packages
- biome: no error-severity violations
- catalog check: "Catalog is up to date" (descriptions are not in generated files, so CI check is unaffected)

**Out of scope:** No changes to generated files (`events.generated.ts`, `actions.generated.ts`, `labels.generated.ts`), no changes to the generator script, no changes to the matcher or engine.
