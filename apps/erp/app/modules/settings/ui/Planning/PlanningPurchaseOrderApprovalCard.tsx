// SPDX-License-Identifier: AGPL-3.0-only
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
  toast,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

// One settings card = one saved concern (archetype F): whether purchase orders
// the planning pages raise skip the approval rule when they are finalized.

export function PlanningPurchaseOrderApprovalCard({
  skipApprovalForPlanningPurchaseOrders
}: {
  skipApprovalForPlanningPurchaseOrders: boolean;
}) {
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const [enabled, setEnabled] = useState(skipApprovalForPlanningPurchaseOrders);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;
    if (fetcher.data.success) {
      toast.success(fetcher.data.message);
    } else {
      // the switch moved before the save: put it back
      setEnabled(skipApprovalForPlanningPurchaseOrders);
      toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data, skipApprovalForPlanningPurchaseOrders]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Purchase Order Approval</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Purchase orders created from Material Planning can be finalized
            without going through the approval rule. Adding, changing or
            deleting a line on one by hand sends it back through approval.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <HStack className="justify-between items-center">
          <VStack className="items-start" spacing={1}>
            <span className="font-medium">
              {enabled ? (
                <Trans>Planning purchase orders skip approval</Trans>
              ) : (
                <Trans>Planning purchase orders need approval</Trans>
              )}
            </span>
            <span className="text-sm text-muted-foreground">
              {enabled ? (
                <Trans>
                  An order raised from Material Planning is released as soon as
                  it is finalized, without an approval request.
                </Trans>
              ) : (
                <Trans>
                  An order raised from Material Planning follows the same
                  approval rule as any other purchase order.
                </Trans>
              )}
            </span>
          </VStack>
          <Switch
            checked={enabled}
            disabled={fetcher.state !== "idle"}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              fetcher.submit(
                {
                  intent: "setPlanningPurchaseOrderApproval",
                  enabled: checked.toString()
                },
                { method: "post" }
              );
            }}
          />
        </HStack>
      </CardContent>
    </Card>
  );
}
