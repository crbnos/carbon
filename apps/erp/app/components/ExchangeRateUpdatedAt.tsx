// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { formatDate, formatRelativeTime } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { LuInfo } from "react-icons/lu";

/** Info icon beside an exchange rate that says when the rate was last updated. */
const ExchangeRateUpdatedAt = ({ value }: { value: string }) => (
  <Tooltip delayDuration={200}>
    <TooltipTrigger asChild>
      <span className="inline-flex items-center">
        <LuInfo className="h-4 w-4 text-muted-foreground" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="bottom">
      <UpdatedAtText value={value} />
    </TooltipContent>
  </Tooltip>
);

// Mounted only while the tooltip is open, so "X ago" is measured at hover
// time rather than when the page rendered.
const UpdatedAtText = ({ value }: { value: string }) => {
  const { locale } = useLocale();
  const relative = formatRelativeTime(value, locale);

  return (
    <>
      <p>
        <Trans>Rate updated {relative}</Trans>
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatDate(value, { dateStyle: "medium", timeStyle: "short" }, locale)}
      </p>
    </>
  );
};

export { ExchangeRateUpdatedAt };
