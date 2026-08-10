import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuLock } from "react-icons/lu";
import { useLocation } from "react-router";
import {
  UpgradeOverlayActions,
  UpgradeOverlayCard,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayTitle
} from "~/components/UpgradeOverlay";
import { useSettings } from "~/hooks";
import { useUIStore } from "~/stores/ui";
import { path } from "~/utils/path";

const gatedRoutes = [
  path.to.reports,
  path.to.intercompany,
  path.to.accountingJournals,
  path.to.accountingPeriods,
  path.to.fixedAssets,
  path.to.depreciationRuns
];

const REQUEST_ACCESS_MESSAGE =
  "I would like to request access to the accounting beta";

export default function AccountingBetaGate() {
  const settings = useSettings();
  const location = useLocation();
  const requestSuggestion = useUIStore((state) => state.requestSuggestion);

  const accountingEnabled = (settings as any).accountingEnabled ?? false;
  if (accountingEnabled) return null;

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
            <Trans>Accounting is disabled for this company.</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Accounting is currently in beta. Request access to enable
              reporting, journal entries, accounting periods, fixed assets, and
              more.
            </Trans>
          </UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <Button
            onClick={() =>
              requestSuggestion({
                suggestion: REQUEST_ACCESS_MESSAGE,
                anonymous: false,
                sendToCarbon: true
              })
            }
          >
            <Trans>Request access</Trans>
          </Button>
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </div>
  );
}
