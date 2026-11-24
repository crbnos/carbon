---
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["accountingEnabled", "accountDefaults?.data"]
promoted: null
---
# Removing a feature flag can expose a fail-open `?.data` guard

**Context:** Before always-posting, the return shipments in `post-shipment` and the sales return receipt in `post-receipt` read the account defaults only when `accountingEnabled` was true. Otherwise `accountDefaults` was null. The journal was written under `if (accountingEnabled && accountDefaults?.data && cost > 0)`. So `accountDefaults?.data` was part of the "accounting is off" test.

**Problem:** The always-post change removed the flag and kept `if (accountDefaults.data && cost > 0)`. After that, the `.data` check only caught a failed read, and it failed open. If the defaults read failed, the post still wrote its stock and cost rows, but it skipped the journal with no error and no log. Typecheck and the tests passed. Commit b9f897608c makes both paths throw "Error getting account defaults" when the read fails.

**Rule:** When you remove a flag, read every condition that used the flag. A null check that meant "feature off" becomes a silent error check when the flag goes. Turn a failed read into a throw before any write. Keep only business conditions, such as `cost > 0`, in the `if`.

**Applies to:** `apps/erp/app/modules/inventory/inventory.service.ts` (return shipments); `apps/erp/app/modules/inventory/inventory.service.ts` (sales return receipt); any flag removal, such as `accountingEnabled` or a plan gate.
