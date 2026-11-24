---
paths: []
triggers: []
promoted: null
---
# A header and the get-method copy into it share one transaction

**Context:** New Version on a make method inserted the `makeMethod` header through supabase-js, set the source version Active, then ran get-method's `makeMethodToMakeMethod` copy, which opened its own Kysely transaction. A version change notice and the Onshape panel's Draft did the same in their own code.

**Problem:** When the copy failed it rolled back only its own rows. The empty Draft stayed, numbered above a source that was now Active and read-only. A first fix deleted them again after the failure; that cleanup could fail too, and it needed a delete the caller may not be allowed to make.

**Rule:** Put the header insert, any status change and the copy in ONE Kysely transaction and pass the transaction to `copyMakeMethod` as `db`. A function that may be handed a transaction opens its own through `withTransaction` (`@carbon/database/client`), never `db.transaction()`: Kysely refuses `transaction()` on a `Transaction`. Every get-method body, and `createMakeMethodVersion` itself, joins that way, so a caller can add its own writes to the same commit (the change notice writes its `changeOrderId` in the insert; the Onshape Draft adds its line ownership and marker) instead of a second write after the commit that can fail alone. Kysely bypasses RLS, so check the policy's permission through the caller's client first (`requireCompanyPermission`), as `createRevision` does.

**Applies to:** `createMakeMethodVersion` (`items.service.ts`) and its callers (`createMethodVersion`, `createChangeNoticeDraftMethod`, `ensureDraftMakeMethod`); any other header insert followed by a get-method copy (quote and job duplication, revisions).
