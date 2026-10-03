// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatTimeOfDay } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useCompanySettings } from "./useCompanySettings";

/**
 * The line under every "Recalculate" button: when MRP runs on its own. Every
 * 3 hours unless the company set a daily time in Settings → Production
 * (`companySettings.mrpRunTime`, on the company's own clock).
 */
export function useMrpScheduleDescription(): string {
  const { t } = useLingui();
  const { locale } = useLocale();
  const mrpRunTime = useCompanySettings()?.mrpRunTime;

  if (!mrpRunTime) {
    return t`MRP runs automatically every 3 hours, but you can run it manually here.`;
  }

  const time = formatTimeOfDay(mrpRunTime, locale);
  return t`MRP runs automatically every day at ${time}, but you can run it manually here.`;
}
