import type { Database } from "@carbon/database";
import { Trans } from "@lingui/react/macro";
import { LuGlobe } from "react-icons/lu";
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
import CustomerPortalsTable from "./CustomerPortalsTable";

type CustomerPortal = Database["public"]["Tables"]["externalLink"]["Row"];

const mockPortals: CustomerPortal[] = [
  {
    id: "mock-1",
    documentType: "Customer",
    documentId: "mock-customer-1",
    customerId: "mock-customer-1",
    supplierId: null,
    expiresAt: null,
    companyId: "mock",
    createdAt: "2026-01-15T10:00:00Z"
  },
  {
    id: "mock-2",
    documentType: "Customer",
    documentId: "mock-customer-2",
    customerId: "mock-customer-2",
    supplierId: null,
    expiresAt: null,
    companyId: "mock",
    createdAt: "2026-02-01T09:30:00Z"
  },
  {
    id: "mock-3",
    documentType: "Customer",
    documentId: "mock-customer-3",
    customerId: "mock-customer-3",
    supplierId: null,
    expiresAt: null,
    companyId: "mock",
    createdAt: "2026-03-20T14:00:00Z"
  }
];

export default function CustomerPortalsUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <CustomerPortalsTable
          appUrl="https://app.carbon.ms"
          data={mockPortals}
          count={mockPortals.length}
        />
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuGlobe className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Customer Portals</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Share a branded portal link so customers can track their orders
              and documents.
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
