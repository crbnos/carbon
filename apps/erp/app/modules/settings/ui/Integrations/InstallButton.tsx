// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { InstallableIntegration } from "./useIntegrationInstall";
import { useIntegrationInstall } from "./useIntegrationInstall";

/**
 * The Install button, wherever an integration is offered — the card in the grid and its
 * Details drawer.
 *
 * An integration this server has no credentials for can never be installed, so its button
 * is disabled and says why on hover. A disabled `<button>` fires no pointer events, so the
 * tooltip hangs off a wrapper around it rather than the button itself.
 */
export function InstallButton({
  integration,
  isDisabled = false,
  onInstall
}: {
  integration: InstallableIntegration & { active: boolean };
  isDisabled?: boolean;
  /** Replaces the default install, e.g. to ask for an install mode first. */
  onInstall?: () => void;
}) {
  const { install, isInstalling } = useIntegrationInstall(integration);

  const button = (
    <Button
      isDisabled={isDisabled || !integration.active || isInstalling}
      isLoading={isInstalling}
      onClick={onInstall ?? install}
    >
      <Trans>Install</Trans>
    </Button>
  );

  if (integration.active) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>
        <Trans>Coming soon</Trans>
      </TooltipContent>
    </Tooltip>
  );
}
