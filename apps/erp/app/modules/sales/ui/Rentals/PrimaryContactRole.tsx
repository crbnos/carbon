// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuInfo } from "react-icons/lu";

const PrimaryContactRole = () => {
  const { t } = useLingui();
  return (
    <HStack spacing={1}>
      <span className="font-medium">
        <Trans>Primary</Trans>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t`What is the primary contact?`}
            className="text-muted-foreground hover:text-foreground"
          >
            <LuInfo className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          <Trans>
            The main person for this rental. Every invoice is made out to them,
            and when invoicing is set to post and email, it is emailed to them.
            The other contacts are for reference, like who to call on site, and
            get no emails.
          </Trans>
        </TooltipContent>
      </Tooltip>
    </HStack>
  );
};

export default PrimaryContactRole;
