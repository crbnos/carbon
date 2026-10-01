// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Ramp's syncer registry.
 *
 * Importing this module is what makes Ramp's syncers resolvable — the same
 * module-scope registration every accounting provider's barrel does, now that
 * `SyncFactory` is keyed on `SyncProviderID` rather than `ProviderID`.
 */

import { SpendProviderID } from "../../accounting/core/models";
import { type SyncerRegistry, SyncFactory } from "../../accounting/core/sync";
import { RampBillSyncer } from "./bill";
import { RampPurchaseOrderSyncer } from "./purchase-order";

export const rampSyncerRegistry: SyncerRegistry = {
  purchaseOrder: RampPurchaseOrderSyncer,
  bill: RampBillSyncer
};

SyncFactory.register(SpendProviderID.RAMP, rampSyncerRegistry);

export { RampBillSyncer, RampPurchaseOrderSyncer };
export type { RampBillRemote } from "./bill";
export type { RampPurchaseOrderRemote } from "./purchase-order";
