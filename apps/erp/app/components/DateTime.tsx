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
