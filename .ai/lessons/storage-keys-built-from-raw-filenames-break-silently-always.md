---
paths: []
triggers: []
promoted: null
---
# Storage keys built from raw filenames break silently — always sanitize, and the portal share route regex is a hidden contract with every upload path shape

**Context:** MES file/inspection step uploads (`RecordModal` in `apps/mes/app/components/JobOperation/components/Step.tsx`) put the raw `file.name` into the Supabase storage key. macOS screenshot names contain U+202F (narrow no-break space before "AM/PM"), which is outside Supabase storage's allowed-key charset.

**Problem:** The upload fails with "Invalid key", but the modal had already rendered the file card (`setFile` before the await), so the operator saw the file "attached" with the Record button permanently disabled — no actionable error. Separately, the customer-portal file route (`share+/customer.$id.$.tsx`) validated paths with a regex hardcoded to the *old* flat layout `companyId/job/operationId/file`; when `032f8d0e` nested step uploads under `/stepId/nanoid/`, every portal file link started returning 403 and nobody noticed for months.

**Rule:** (1) Any storage key that embeds a user-controlled filename must pass it through `stripSpecialCharacters` (canonical copy in `@carbon/utils`, re-exported by `~/utils/string` in ERP) with a `|| "file"` fallback for names that sanitize to empty. (2) The share-route path validation (`parseJobFilePath` in `apps/erp/app/utils/supabase.ts`, unit-tested) is coupled to every writer of the `companyId/job/...` prefix — changing an upload path shape requires updating the parser and its test in the same PR. The route also serves a file only when a File step's `jobOperationStepRecord.value` is that exact path (`getJobOperationFileRecord`) and its extension is a photo or PDF (`customerPortalServesFile`, `sales.utils.ts`), so a writer that stores a different value than the uploaded key breaks portal downloads the same way (`apps/erp/test/database/customer-portal.test.ts`). (3) On upload failure, reset the picker UI so the user can retry; never leave a dead-end state.

**Applies to:** all `storage.from(...).upload(...)` call sites in `apps/mes` and `apps/erp`; `share+/customer.$id.$.tsx`; any new externally-shared file route.
