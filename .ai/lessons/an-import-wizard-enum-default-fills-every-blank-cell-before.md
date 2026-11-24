---
paths: ["apps/erp/app/modules/shared/imports.models.ts", "apps/erp/app/modules/shared/shared.method-import-append.test.ts"]
triggers: ["fieldMappings"]
promoted: null
---
# An import wizard enum Default fills every blank cell before the server sees it

**Context:** The method import (#1977) was made to fill a blank BOM Unit of Measure with the material's own unit and a blank Operation Type with the process's type, as the BOM and BOP editors do.

**Problem:** `fieldMappings` in `imports.models.ts` preset `default: "EA"` and `default: "Process"`. The wizard writes an enum's Default into every blank and unmapped cell before the import runs, so the server never saw a blank and its fallbacks never ran. The server-side change and its tests looked right; only a run through the wizard showed every line still in EA.

**Rule:** When the server derives a value for a blank cell, remove that field's `default` from `fieldMappings`, and pin the absence in a test (`shared.method-import-append.test.ts` → "presets no BOM unit and no operation type"). A wizard Default and a server fallback cannot both apply.

**Applies to:** every table in `fieldMappings` (`apps/erp/app/modules/shared/imports.models.ts`) whose importer has a fallback for a blank cell.
