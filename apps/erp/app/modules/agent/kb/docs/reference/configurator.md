# Configurator

> Turn one part number into a parametric family. Inputs drive rules that resolve the BOM, routing, and price per order.

Some parts aren't one fixed recipe. A bracket comes in three lengths, a panel in four finishes, a valve in a dozen bore sizes. Carbon's **configurator** lets a single item carry a set of **parameters** the ordering user fills in, and **rules** that read those parameters to resolve the item's method at order time: which components go on the `docs/reference/methods`, how the routing runs, and what the line costs. One part number, a parametric family behind it.

A part becomes configurable when you tick **"Requires Configuration"** on its manufacturing settings (`requiresConfiguration`, `apps/erp/app/modules/items/ui/Item/ItemManufacturingForm.tsx:82`). From then on the part is configured: its stored method is a *template*, and every job or quote line built from it runs the rules to produce its own resolved copy.

## Parameters — the inputs

Parameters are the questions the configurator asks. Each one is defined on the part (`configurationParameterValidator`, `apps/erp/app/modules/items/items.models.ts:341`) with a **label**, a machine **key**, and a **data type**. The key is alphanumeric with underscore separators (`length`, `wall_thickness`), lowercase by convention — it's the name your rules reference.

  - **text**: A free-text value.
  - **numeric**: A number — a length, a count, a bore size.
  - **boolean**: A yes/no toggle.
  - **list**: One of a fixed set of options you supply (`listOptions` is required for this type).
  - **material**: A reference to a real material item, optionally filtered to one material form.
  - **date**: A calendar date.

The base set (`text`, `numeric`, `boolean`, `list`, `material`) is `configurationParameterDataTypes` (`items.models.ts:22`); `date` is added by the validator (`items.models.ts:347`). `material` was added to the underlying enum in migration `20250809000000_add-material-configurator-type.sql`.

Parameters can be sorted into **groups** so the order form reads as sections (Dimensions, Finish, Tolerances) rather than one flat list. A group is just a named heading with a sort order (`configurationParameterGroupValidator`, `items.models.ts:325`); parameters land in an auto-created **"Ungrouped"** group until you file them. Both groups and parameters reorder by drag-and-drop, and both surfaces edit the same rows (`ConfigurationParameters.tsx`).

## Rules — deriving the method

A **rule** binds a *field* of the method to a snippet of code (`configurationRuleValidator`, `items.models.ts:369`). The field names which piece of the resolved method the rule sets; the code computes the value from the parameters.

Rules attach per-field right on the embedded `docs/reference/methods` editors. On the bill of materials each component exposes configurable fields — `itemId` (swap the component), `quantity`, `unitOfMeasureCode`, and `methodType` (`BillOfMaterial.tsx:841,866,890,1043`); on the bill of process, operation fields like the work center, process, and setup/labor/machine times. A field with a rule shows a "configured" marker instead of a static value.

You author the code in a **Monaco editor** (`ConfigurationEditor.ee.tsx`) that generates the function skeleton and type definitions for you from the parameters, with a **Run** button to test the output before saving. The code is the body of a `configure(params)` function; `params` holds your parameters by key, and you `return` the value for that field:

```typescript
function configure(params: Params): number {
  // one thread every 2mm of engagement, minimum 4
  return Math.max(4, Math.ceil(params.engagement_length / 2));
}
```

Rule code is transpiled and executed in a restricted sandbox (`packages/database/supabase/functions/lib/sandbox.ee.ts`): no `fetch`, no `setTimeout`/`setInterval`, no dynamic `import`, no `new Promise`, no `Function` constructor. A rule that trips a banned pattern is neutered to `return null`, and any rule that throws falls back to the field's default. Rules are for deriving a value from the inputs, not for side effects.

Rules can also **filter** the method wholesale: a `billOfMaterial` or `billOfProcess` rule returns the list of component or operation names to keep, so a boolean parameter can drop a whole subassembly or an outside-processing step from the recipe.

## Choosing a configured item at order time

The configurator is exercised where a configured part is put on a `docs/reference/quotes` or a `docs/reference/sales-orders` line, and where a `docs/reference/jobs` is created for it. When the picked item requires configuration, the line form shows a **"Configure"** button (`QuoteLineForm.tsx:556`, `JobForm.tsx`) that opens the parameter form. Until it's filled in, **"Save"** stays disabled — you can't commit a configured line without answering its parameters.

Submitting the configuration stores the answers on the line (`quoteLine.configuration` / `job.configuration`, JSON) and calls the `docs/reference/methods` engine with those values (`x+/quote+/$quoteId.$lineId.configure.tsx`). The rules run, and the line gets its own resolved bill of materials, routing, and cost — a concrete instance of the parametric family, not the template. Reconfiguring clears the line's prices and re-derives everything.

Because the method is resolved from rules, you can't point a job or line at a different method for a configured item — the get-method engine rejects it ("Cannot override method of configured item"). Change the parameters, not the recipe.

## Troubleshooting

Validator rejections when defining parameters, and the gates around configured items.

### "Key must be lowercase and underscore separated"
A parameter's machine **key** doesn't match the allowed shape (alphanumeric with single underscore separators, e.g. `wall_thickness`). Fix the key — spaces, hyphens, or leading/trailing/doubled underscores are rejected. The key is what your rules reference, so it can't be free text.

### "List options are required"
You set a parameter's data type to **list** but didn't supply its options. A `list` parameter must define the fixed set of choices; add them, or switch the type.

### "Cannot override method of configured item"
You tried to point a job or line at a different `docs/reference/methods` for an item whose `requiresConfiguration` is on. A configured item's method is resolved from rules, not chosen — the get-method engine rejects the override. Change the **parameters**, not the recipe.

### A rule returns null / falls back to the default
The rule tripped the sandbox. Rule code runs in a restricted sandbox that bans `fetch`, `setTimeout`/`setInterval`, dynamic `import`, `new Promise`, and the `Function` constructor; a rule containing any banned pattern is neutered to `return null`, and any rule that throws falls back to the field's default. Keep rules pure — derive a value from the inputs, no side effects.

### "Save" stays disabled on a configured line
When the picked item requires configuration, **"Save"** is disabled until the line is configured — the form shows a **"Configure"** button until you answer its parameters. Click **"Configure"**, fill in the parameters, and submit; Save then enables. (Reconfiguring clears the line's prices and re-derives its method.)

## Related

  - Items The item master and its type-specific settings, including "Requires Configuration".
  - Methods & sourcing The bill of materials and routing a configurator resolves per order.
