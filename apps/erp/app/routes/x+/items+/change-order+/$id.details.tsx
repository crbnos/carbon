import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ChangeOrder, ChangeOrderActionTask } from "~/modules/items";
import { canEditChangeOrder } from "~/modules/items";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeOrder";
import {
  ChangeOrderActions,
  ChangeOrderChanges,
  ChangeOrderContent
} from "~/modules/items/ui/ChangeOrder";
import ChangeOrderStatusFlow from "~/modules/items/ui/ChangeOrder/ChangeOrderStatusFlow";
import { path } from "~/utils/path";

// Top-level change-order detail (the CO overview) — mirrors the sales order
// `$orderId.details` and the quality issue `$id.details`: the CO-wide state flow,
// the two rich-text narrative fields (reason for change + description, edited the
// same way as the issue's description), the total changes rollup (every affected
// item's authoring diff), and the action tasks (with the shared "Add Actions"
// picker). Affected items live in their own line routes (`$id.$affectedId.details`),
// linked from the explorer.
export default function ChangeOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    actions: ChangeOrderActionTask[];
    affectedItems: AffectedItemDraft[];
  }>(path.to.changeOrder(id));
  const changeOrder = routeData?.changeOrder;

  if (!changeOrder) throw new Error("Could not find change order data");

  const isDisabled = !canEditChangeOrder(changeOrder.status);

  // Same shape the release dialog reviews (label + per-item diff), plus the
  // change type + draft version for the badge in the Changes rollup.
  const changes = (routeData?.affectedItems ?? []).map((a) => ({
    id: a.affectedItem.id,
    label: a.affectedItem.item?.readableIdWithRevision ?? a.affectedItem.itemId,
    name: a.affectedItem.item?.name ?? null,
    changeType: a.affectedItem.changeType,
    version: a.makeMethod?.version,
    diff: a.diff
  }));

  return (
    <VStack spacing={2} className="p-2">
      <ChangeOrderStatusFlow status={changeOrder.status} />
      <ChangeOrderChanges changes={changes} />
      <ChangeOrderContent
        id={id}
        reasonForChange={changeOrder.reasonForChange as JSONContent}
        description={changeOrder.description as JSONContent}
        isDisabled={isDisabled}
      />
      <ChangeOrderActions
        changeOrderId={id}
        actions={routeData?.actions ?? []}
        isDisabled={isDisabled}
      />
    </VStack>
  );
}
