// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DateTimeProps } from "@carbon/react";
import { DateTime as DateTimeBase } from "@carbon/react";
import { useCompanyTimeZone } from "~/hooks/useCompanyTimeZone";

/**
 * ERP timestamps always know the company zone (the ledger calendar).
 * Location-scoped screens (jobs, scheduling, shifts) additionally pass the
 * row's `locationTimeZone` so the popover shows the operational calendar too.
 */
const DateTime = (props: DateTimeProps) => {
  const companyTimeZone = useCompanyTimeZone();
  return <DateTimeBase companyTimeZone={companyTimeZone} {...props} />;
};

export { DateTime };
