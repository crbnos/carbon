/**
 * Deno-compatible re-export of seed data for edge functions.
 * Source of truth is packages/database/src/seed/seed.data.ts
 */

export {
  accountDefaults,
  accounts,
  currencies,
  customerStatuses,
  dimensions,
  failureModes,
  fiscalYearSettings,
  fixedAssetClasses,
  gaugeTypes,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  scrapReasons,
  sequences,
  unitOfMeasures,
} from "./seed.data.ts";

import { groups as _groups } from "./seed.data.ts";

export const groupCompanyTemplate = "XXXX-XXXX-XXXXXXXXXXXX";

export const groups = _groups.map(({ idPrefix, ...g }) => ({
  ...g,
  id: `${idPrefix}-${groupCompanyTemplate}`,
}));
