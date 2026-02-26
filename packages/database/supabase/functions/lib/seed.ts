/**
 * Deno-compatible re-export of seed data for edge functions.
 * Source of truth is packages/database/src/seed/seed.data.ts
 */

export {
  accountCategories,
  accountDefaults,
  accounts,
  currencies,
  customerStatuses,
  failureModes,
  fiscalYearSettings,
  gaugeTypes,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  postingGroupInventory,
  postingGroupPurchasing,
  postingGroupSales,
  scrapReasons,
  sequences,
  unitOfMeasures,
  supplierStatuses as supplierStauses,
} from "./seed.data.ts";

import { groups as _groups } from "./seed.data.ts";

export const groupCompanyTemplate = "XXXX-XXXX-XXXXXXXXXXXX";

export const groups = _groups.map(({ idPrefix, ...g }) => ({
  ...g,
  id: `${idPrefix}-${groupCompanyTemplate}`,
}));
