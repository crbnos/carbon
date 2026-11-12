// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { LuGroup } from "react-icons/lu";
import {
  UpgradeOverlay,
  UpgradeOverlayActions,
  UpgradeOverlayCard,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayPreview,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";

// A faux list so the blurred backdrop reads as "planning groups" without
// depending on loader data.
const rows = [
  { name: "Star Tracker", members: 3 },
  { name: "Reaction Wheels", members: 2 },
  { name: "Ground Support", members: 4 }
];

export default function PlanningGroupsUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <div className="flex h-full flex-col gap-2 p-6">
          {rows.map((row) => (
            <div
              key={row.name}
              className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-3 text-sm"
            >
              <span>{row.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {row.members}
              </span>
            </div>
          ))}
        </div>
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuGroup className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Planning Groups</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Plan several projects as one, buy once for all of them, and see
              which project each order is for.
            </Trans>
          </UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </UpgradeOverlay>
  );
}
