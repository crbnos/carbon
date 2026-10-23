// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type {
  ServiceBillingMethod,
  ServiceWorkSite
} from "../../service.models";

/** Where the work is done: at our depot or at the customer's site. */
export function useWorkSiteLabels(): Record<ServiceWorkSite, string> {
  const { t } = useLingui();
  return {
    Depot: t`Depot`,
    "Customer Site": t`Customer Site`
  };
}

/** How a Billable job bills: its time and parts, or one fixed price. */
export function useBillingMethodLabels(): Record<ServiceBillingMethod, string> {
  const { t } = useLingui();
  return {
    "Time and Materials": t`Time and Materials`,
    "Fixed Price": t`Fixed Price`
  };
}
