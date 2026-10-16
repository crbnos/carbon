// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  updateAccountingSettings,
  updateInventorySettings,
  updateInvoicingSettings,
  updateItemsSettings,
  updatePeopleSettings,
  updatePlanningSettings,
  updateProductionSettings,
  updatePurchasingSettings,
  updateQualitySettings,
  updateResourcesSettings,
  updateSalesSettings,
  updateSecuritySettings,
  writeMissingJournals
} from "./settings.server";

/** The settings module's operations, by entity. */
export const settings = {
  // One update per settings page: it writes the fields sent.
  accounting: {
    update: updateAccountingSettings,
    writeMissingJournals
  },
  inventory: { update: updateInventorySettings },
  invoicing: { update: updateInvoicingSettings },
  items: { update: updateItemsSettings },
  people: { update: updatePeopleSettings },
  planning: { update: updatePlanningSettings },
  production: { update: updateProductionSettings },
  purchasing: { update: updatePurchasingSettings },
  quality: { update: updateQualitySettings },
  resources: { update: updateResourcesSettings },
  sales: { update: updateSalesSettings },
  security: { update: updateSecuritySettings }
};
