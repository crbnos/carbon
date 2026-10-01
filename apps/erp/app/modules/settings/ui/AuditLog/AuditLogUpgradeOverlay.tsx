// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Switch,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuHistory } from "react-icons/lu";
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

export default function AuditLogUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <VStack spacing={4} className="py-12 px-4 max-w-[60rem] mx-auto gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Audit Logging</CardTitle>
              <CardDescription>
                Track changes to key business entities including invoices,
                orders, customers, suppliers, and more.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HStack className="justify-between items-center">
                <VStack className="items-start" spacing={1}>
                  <span className="font-medium">Audit logging is disabled</span>
                  <span className="text-sm text-muted-foreground">
                    Enable to start tracking changes to your data.
                  </span>
                </VStack>
                <Switch checked={false} disabled />
              </HStack>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Archived Logs</CardTitle>
              <CardDescription>
                Logs older than 30 days are automatically archived.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VStack className="gap-2">
                {[1, 2].map((i) => (
                  <HStack
                    key={i}
                    className="justify-between items-center p-6 border rounded-md w-full"
                  >
                    <VStack className="items-start">
                      <span className="font-medium text-sm">
                        Jan 1, 2026 - Jan 31, 2026
                      </span>
                      <span className="text-xs text-muted-foreground">
                        1,234 records (2.1 MB)
                      </span>
                    </VStack>
                    <div className="h-8 w-24 rounded bg-muted" />
                  </HStack>
                ))}
              </VStack>
            </CardContent>
          </Card>
        </VStack>
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuHistory className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Audit Logs</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Track every change to your orders, invoices, customers, suppliers,
              and more.
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
