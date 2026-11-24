---
paths: []
triggers: []
promoted: null
---
# A text replace on a function name also renames its prefix siblings

**Context:** The service-function migration (2026-10-16) renamed thousands of call sites with scripts.

**Problem:** A string or regex replace of `getJob` also matched `getJobs`, `getJobOperation` and every other name that starts with it, and matched the name inside strings and comments. One pass also left a stray suffix on a public name (`createSupplierInteractionLineDocumentUploadUrlTool`), which renamed an MCP tool without anyone asking for it.

**Rule:** Rename code through ts-morph references (`findReferencesAsNodes`, `rename`), never through text. After a mass rename, diff the published tool names against main (`tool-manifest.digest.json`) and explain every added and removed name.

**Applies to:** codemods over `apps/erp/app/modules/**` and any script that renames exports.
