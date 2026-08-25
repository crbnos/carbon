import { Badge, Button, HStack, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuWorkflow } from "react-icons/lu";
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

const mockRows = [
  {
    name: "New Order Notification",
    event: "sales.order.created",
    published: true
  },
  {
    name: "Low Stock Alert",
    event: "inventory.stock.below-minimum",
    published: true
  },
  {
    name: "Invoice Overdue",
    event: "accounting.invoice.overdue",
    published: false
  },
  { name: "Supplier PO Sent", event: "purchasing.order.sent", published: true }
];

export default function WorkflowsUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <VStack spacing={0} className="h-full p-6 gap-4">
          <HStack className="justify-between w-full">
            <span className="text-lg font-semibold">
              <Trans>Workflows</Trans>
            </span>
            <Button size="sm" isDisabled>
              <Trans>New Workflow</Trans>
            </Button>
          </HStack>
          <div className="w-full rounded-md border overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 border-b bg-muted text-xs font-medium text-muted-foreground">
              <span>
                <Trans>Name</Trans>
              </span>
              <span>
                <Trans>Trigger</Trans>
              </span>
              <span>
                <Trans>Status</Trans>
              </span>
            </div>
            {mockRows.map((row) => (
              <div
                key={row.name}
                className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-3 border-b last:border-b-0 text-sm items-center"
              >
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground text-xs font-mono">
                  {row.event}
                </span>
                <Badge variant={row.published ? "green" : "gray"}>
                  {row.published ? (
                    <Trans>Published</Trans>
                  ) : (
                    <Trans>Draft</Trans>
                  )}
                </Badge>
              </div>
            ))}
          </div>
        </VStack>
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuWorkflow className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Workflows</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Automate your business processes with event-driven workflows that
              trigger actions when things happen in Carbon.
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
