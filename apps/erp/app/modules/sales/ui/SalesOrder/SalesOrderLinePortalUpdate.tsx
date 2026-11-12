// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Textarea
} from "@carbon/react";
import { useFetcher } from "react-router";
import { customerPortalLateReasons } from "~/modules/sales/sales.models";

type UpdateResult = { success: boolean; message: string };

export function SalesOrderLinePortalUpdate({
  orderId,
  lineId,
  lateReason,
  deliveryUpdate,
  canEdit
}: {
  orderId: string;
  lineId: string;
  lateReason: string | null;
  deliveryUpdate: string | null;
  canEdit: boolean;
}) {
  const fetcher = useFetcher<UpdateResult>();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer portal update</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          These optional messages are visible to the customer on their order.
          Clear a field to remove it.
        </p>
        <fetcher.Form
          method="post"
          action={`/x/sales-order/${orderId}/${lineId}/portal-update`}
          className="space-y-4"
        >
          <label className="block space-y-1 text-sm font-medium">
            <span>Late reason</span>
            <select
              name="portalLateReason"
              defaultValue={lateReason ?? ""}
              disabled={!canEdit}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">No late reason</option>
              {customerPortalLateReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>Delivery update</span>
            <Textarea
              name="portalDeliveryUpdate"
              defaultValue={deliveryUpdate ?? ""}
              maxLength={2000}
              disabled={!canEdit}
              placeholder="Describe the next expected delivery"
            />
          </label>
          {fetcher.data && (
            <p
              role="status"
              className={
                fetcher.data.success
                  ? "text-sm text-emerald-600"
                  : "text-sm text-destructive"
              }
            >
              {fetcher.data.message}
            </p>
          )}
          {canEdit && (
            <Button
              type="submit"
              variant="primary"
              isDisabled={fetcher.state !== "idle"}
            >
              {fetcher.state === "idle" ? "Save portal update" : "Saving…"}
            </Button>
          )}
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}
