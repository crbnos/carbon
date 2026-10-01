// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { LuWebhook } from "react-icons/lu";
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
import type { Webhook } from "~/modules/settings";
import WebhooksTable from "./WebhooksTable";

const mockWebhooks: Webhook[] = [
  {
    id: "mock-1",
    name: "Order created",
    url: "https://api.example.com/orders",
    table: "salesOrder",
    active: true,
    onInsert: true,
    onUpdate: false,
    onDelete: false,
    successCount: 1247,
    errorCount: 12,
    lastSuccess: "2026-05-05T14:22:00Z",
    lastError: null,
    createdAt: "2026-01-15T10:00:00Z",
    createdBy: "mock-user-1",
    updatedAt: null,
    updatedBy: null,
    companyId: "mock"
  },
  {
    id: "mock-2",
    name: "Customer updated",
    url: "https://hooks.example.com/customer",
    table: "customer",
    active: true,
    onInsert: true,
    onUpdate: true,
    onDelete: false,
    successCount: 856,
    errorCount: 32,
    lastSuccess: "2026-05-05T13:10:00Z",
    lastError: "2026-05-04T09:15:00Z",
    createdAt: "2026-02-01T09:30:00Z",
    createdBy: "mock-user-1",
    updatedAt: null,
    updatedBy: null,
    companyId: "mock"
  },
  {
    id: "mock-3",
    name: "Invoice paid",
    url: "https://api.example.com/invoices/paid",
    table: "salesInvoice",
    active: true,
    onInsert: false,
    onUpdate: true,
    onDelete: false,
    successCount: 412,
    errorCount: 0,
    lastSuccess: "2026-05-05T11:45:00Z",
    lastError: null,
    createdAt: "2026-02-10T11:45:00Z",
    createdBy: "mock-user-2",
    updatedAt: null,
    updatedBy: null,
    companyId: "mock"
  },
  {
    id: "mock-4",
    name: "Item deleted",
    url: "https://hooks.example.com/items",
    table: "item",
    active: false,
    onInsert: false,
    onUpdate: false,
    onDelete: true,
    successCount: 23,
    errorCount: 28,
    lastSuccess: "2026-04-20T16:00:00Z",
    lastError: "2026-04-25T08:30:00Z",
    createdAt: "2026-03-20T14:00:00Z",
    createdBy: "mock-user-2",
    updatedAt: null,
    updatedBy: null,
    companyId: "mock"
  }
];

export default function WebhooksUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <WebhooksTable data={mockWebhooks} count={mockWebhooks.length} />
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuWebhook className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Webhooks</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Push record changes to external systems the moment they happen.
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
