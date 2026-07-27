# Materials

> The property tables that give a material its identity — substance, form, dimension, finish, grade, and type.

A **material** is an `docs/reference/items` of type *Material*: the raw stock you cut, form, and consume rather than a finished part. What makes it a material is a small set of structured **property tables**. Instead of typing "1/16-inch cold-rolled 304 stainless sheet" into a name field, you pick a **substance**, a **form**, a **dimension**, and optionally a **finish**, **grade**, and **type**. Those choices compose the material's identity and drive its readable name and code.

Each material row (`material` table) carries only foreign keys into these lookups: `materialSubstanceId`, `materialFormId`, `dimensionId`, `finishId`, `gradeId`, and `materialTypeId`. All six are nullable, so a material can be as loosely or tightly specified as you need.

## The property tables

Six lookup tables compose a material. Two describe the material in the abstract (**substance** and **form**); the rest are scoped to one of those, so the choices cascade.

  - **Substance**: What the material is made of: steel, aluminum, stainless, titanium. Has a `name` and a `code`.
  - **Form**: Its shape or product form: sheet, plate, round bar, ingot. Has a `name` and a `code`.
  - **Dimension**: A named size, scoped to a **form** (a sheet's dimension list differs from a bar's). Carries `isMetric`.
  - **Finish**: A surface finish, scoped to a **substance**.
  - **Grade**: A material grade, scoped to a **substance** (for example a steel grade like 1018).
  - **Type**: A named product type keyed to a **substance and a form** together, such as hot-rolled steel plate. Has a `name` and a `code`.

Substance and form stand alone. **Grade** and **finish** are picked from the list for the chosen substance; **dimension** from the list for the chosen form; **type** from the intersection of both. Change the substance and the grade or finish list you can pick from changes with it. This is why the material form on new-material screens fills top down.

## Scope: system-wide or per company

The property tables ship with a starter taxonomy. Every lookup has a **nullable `companyId`**: rows with `companyId` null are system-seeded and visible to every company; rows with your company id are your own additions. You inherit a working set of substances, forms, and grades out of the box and extend it per company without touching anyone else's.

Uniqueness is enforced per scope so a system value and a company value never collide:

  - **materialSubstance**: Substances are unique by code within a company.
  - **materialForm**: Forms are unique by code within a company.
  - **materialDimension**: A dimension name is unique within its form.
  - **materialFinish**: A finish name is unique within its substance.
  - **materialGrade**: A grade name is unique within its substance.
  - **materialType**: A type is unique by both code and name within a substance-and-form pair.

Only `materialSubstance` and `materialForm` have a `code`, custom fields, and audit columns. `materialDimension`, `materialFinish`, `materialGrade`, and `materialType` are lean lookups with no custom fields and no audit trail, and their seeded ids are human-readable (like `steel-1018`) rather than generated keys.

## How a material references them

A material links to its item positionally, not through a foreign key. When you create one, Carbon inserts the `item` row first with `type` set to *Material*, then inserts the `material` row using the **item's readable id** as `material.id`. There is no `itemId` column. The two are joined on `item.readableId = material.id` within a company, so a material's part number *is* its material id.

Because the join is on the readable id, one material can span several item records: separate **revisions**, and a separate item per stock size. The `sizes` you assign become selectable variants on `docs/reference/jobs` and purchase orders, each its own item row sharing the material's id.

When Carbon generates the material and its ids, `materialSubstanceId` and `materialFormId` are required; dimension, finish, grade, and type are optional. A material is minimally "a substance in a form" and everything else refines it.

## Naming and uniqueness

The property choices are what make a material both readable and unique. Carbon composes the display name and code from the taxonomy rather than from free text: substance, form, and where set the finish, grade, and dimension names build the readable name, while the substance, form, and type **codes** build the material code. Two materials that resolve to the same combination of properties are the same material, which is the point of driving identity from the tables instead of a typed string.

Because dimensions belong to forms and grades and finishes belong to substances, a valid material is always an internally consistent set of choices. You cannot pick a bar dimension for a sheet, or a stainless grade for aluminum, because those lists are filtered to the parent you already chose.

## Related

  - Items A material is an item of type *Material*; item fields like tracking and unit of measure live here.
  - Methods & sourcing Materials become the components of a method's bill of materials.

## Troubleshooting

Materials are validated more by required-property gates than by error text. The gates below depend on whether ids are auto-generated.

### "Substance is required" / "Shape is required"
Raised when creating a material with **auto-generated ids** on (`companySettings.materialGeneratedIds`). In that mode Carbon composes the id and name from the taxonomy, so **substance** and **form** ("Shape") are both mandatory; dimension, finish, grade, and type stay optional. Pick a substance and a form.

### "Material ID is required"
Raised when ids are **manual** (`materialGeneratedIds` off): the form shows a Material ID field and it can't be blank. Turn auto-generation on to have Carbon derive the id instead.

### The Material ID field is missing (or is shown) when I didn't expect it
The field's visibility is the `companySettings.materialGeneratedIds` gate. **On** (auto): the id and short description are hidden and derived from the properties, and editing substance/form/type/dimension/finish/grade re-generates the id and name. **Off** (manual): you type the id yourself and it's required.

### Creating a property lookup is rejected for a missing parent
The property tables cascade, and each validator requires its parent scope: **finish** and **grade** need a substance ("Substance is required"), **dimension** needs a form ("Shape is required"), and **type** needs both ("Substance is required", "Shape is required"). Substance, form, and type also require a **"Name is required"** and **"Code is required"**; dimension, finish, and grade require only a name. Select the parent first, then name the value.

### "Failed to insert material" / "Failed to update material"
The save failed at the service layer. A common cause is a material id collision — an id that resolves to an already-existing material (materials are unique by their composed properties), surfaced as a database constraint error. Change a property or the id so the combination is unique.
