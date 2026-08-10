import type { DateTimeProps } from "@carbon/react";
import { DateTime as DateTimeBase } from "@carbon/react";
import {
  useCompanyTimeZone,
  useLocationTimeZone
} from "~/hooks/useCompanyTimeZone";

/**
 * MES timestamps carry both calendars: the company (ledger) zone and the
 * current location's zone — the shop floor runs on the site's clock.
 */
const DateTime = (props: DateTimeProps) => {
  const companyTimeZone = useCompanyTimeZone();
  const locationTimeZone = useLocationTimeZone();
  return (
    <DateTimeBase
      companyTimeZone={companyTimeZone}
      locationTimeZone={locationTimeZone}
      {...props}
    />
  );
};

export { DateTime };
