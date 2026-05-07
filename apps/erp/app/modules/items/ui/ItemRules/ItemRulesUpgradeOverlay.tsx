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
    name: "Require lot number on receipt",
    severity: "error" as const,
    active: true,
    description: "Block receiving when lot number is missing.",
    message: "Lot number is required for this item on receipt.",
    updatedAt: "2026-05-04T10:00:00Z",
    customFields: {},
    assignmentCount: 24,
    surfaces: ["receipt"] as const
  },
  {
    id: "mock-2",
    name: "Warn on negative adjustment",
    severity: "warn" as const,
    active: true,
    description: "Flag inventory adjustments that take quantity below zero.",
    message: "Adjustment will result in negative on-hand quantity.",
    updatedAt: "2026-04-29T14:22:00Z",
    customFields: {},
    assignmentCount: 12,
    surfaces: ["inventoryAdjustment"] as const
  },
  {
    id: "mock-3",
    name: "Shipment requires serial",
    severity: "error" as const,
    active: true,
    description: "Block shipment when serial number is not captured.",
    message: "Serial number is required on shipment.",
    updatedAt: "2026-04-21T09:15:00Z",
    customFields: {},
    assignmentCount: 8,
    surfaces: ["shipment"] as const
  },
  {
    id: "mock-4",
    name: "Stock transfer between plants",
    severity: "warn" as const,
    active: false,
    description: "Warn when transferring between non-default plants.",
    message: "Cross-plant transfer requires manager approval.",
    updatedAt: "2026-03-12T11:45:00Z",
    customFields: {},
    assignmentCount: 3,
    surfaces: ["stockTransfer"] as const
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
              Enforce per-item validation and guidelines across receipts,
              shipments, transfers, and adjustments.
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
