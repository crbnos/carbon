// Plan-gate overlay for Items → Item Rules. Mirrors
// `~/modules/inventory/ui/StorageRules/StorageRulesUpgradeOverlay`.

import { Trans } from "@lingui/react/macro";
import { LuShieldCheck } from "react-icons/lu";
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
import ItemRulesTable from "./ItemRulesTable";

const mockRules = [
  {
    id: "mock-1",
    name: "Block export-restricted destinations",
    severity: "error" as const,
    active: true,
    description: "Block quoting restricted parts to embargoed countries.",
    message: "This part cannot be sold to the selected destination.",
    updatedAt: "2026-05-04T10:00:00Z",
    customFields: {},
    assignmentCount: 18,
    surfaces: ["quoteLine", "salesOrderLine"] as const
  },
  {
    id: "mock-2",
    name: "Warn on inactive customer status",
    severity: "warn" as const,
    active: true,
    description: "Flag lines for customers whose status is not active.",
    message: "Customer status requires review before ordering.",
    updatedAt: "2026-04-29T14:22:00Z",
    customFields: {},
    assignmentCount: 6,
    surfaces: ["salesOrderLine"] as const
  },
  {
    id: "mock-3",
    name: "Distributor-only parts",
    severity: "error" as const,
    active: false,
    description: "Restrict select parts to distributor customer types.",
    message: "This part is only available to distributors.",
    updatedAt: "2026-04-21T09:15:00Z",
    customFields: {},
    assignmentCount: 3,
    surfaces: ["quoteLine"] as const
  }
];

export default function ItemRulesUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <ItemRulesTable data={mockRules as never} count={mockRules.length} />
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuShieldCheck className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Item Rules</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Enforce customer and item checks when items are added to quotes
              and sales orders.
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
