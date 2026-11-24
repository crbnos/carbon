---
paths: ["apps/erp/app/components/Form/FormLayout.tsx", "apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx"]
triggers: ["FormSection", "CollapsibleContent"]
promoted: null
---
# A collapsed form section keeps its fields mounted

**Context:** The New Project drawer and the project Settings page fold advanced fields into sections (`FormSection`, `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx`). The form posts the whole record (`projectValidator`), and the action writes every column it receives.

**Problem:** A section that unmounts its fields when closed posts nothing for them. The action would then write null or the default for each of those columns, so saving the name on Settings would clear the cost account, the planning group or the plan lock, with no error. (Decision D14 of the rebuild plan; caught at design time, not in production.)

**Rule:** A collapsible section inside a form that saves the whole record renders its children with `forceMount` and hides them (`CollapsibleContent forceMount className={cn(!open && "hidden")}`). It also opens while one of its fields has a validation error (`fieldNames`), so an error is never hidden. The same holds for any field hidden by a condition (a DCAA-only card): hide it, keep it mounted.

**Applies to:** `FormSection` and every collapsible group or conditional card inside a `ValidatedForm` whose action saves all fields at once.
