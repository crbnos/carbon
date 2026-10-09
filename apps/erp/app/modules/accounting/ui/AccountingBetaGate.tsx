// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuLock } from "react-icons/lu";
import { Link, useLocation } from "react-router";
import {
  UpgradeOverlayActions,
  UpgradeOverlayCard,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayTitle
} from "~/components/UpgradeOverlay";
import { useSettings } from "~/hooks";
import { path } from "~/utils/path";
import { hasAccountingCutover } from "../accounting.models";

const gatedRoutes = [
  path.to.reports,
  path.to.intercompany,
  path.to.accountingJournals,
  path.to.accountingPeriods,
  path.to.fixedAssets,
  path.to.depreciationRuns
];

export default function AccountingBetaGate() {
  const settings = useSettings();
  const location = useLocation();

  // The enable wizard is how a company turns accounting on, so it is never
  // behind the gate.
  if (location.pathname.startsWith(path.to.accountingActivation)) return null;

  if (hasAccountingCutover(settings)) return null;

  const isGated = gatedRoutes.some((route) =>
    location.pathname.startsWith(route)
  );
  if (!isGated) return null;

  return (
    <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-sm">
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuLock className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Accounting is not set up for this company.</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Set up accounting to use reports, journal entries, accounting
              periods, fixed assets and more.
            </Trans>
          </UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <Button asChild>
            <Link to={path.to.accountingActivation}>
              <Trans>Set up accounting</Trans>
            </Link>
          </Button>
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </div>
  );
}
