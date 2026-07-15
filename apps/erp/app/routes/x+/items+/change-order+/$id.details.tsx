import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderReleaseConflict
} from "~/modules/items";
import { canEditChangeOrder } from "~/modules/items";
import type { ChangeOrderDiff } from "~/modules/items/changeOrder.diff";
import type {
  AffectedItemDraft,
  ChangeOrderImpactItem
} from "~/modules/items/ui/ChangeOrder";
import ChangeOrderWorkspace from "~/modules/items/ui/ChangeOrder/ChangeOrderWorkspace";
import { path } from "~/utils/path";

export default function ChangeOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    affectedItems: AffectedItemDraft[];
    diff: ChangeOrderDiff;
    releaseConflicts: ChangeOrderReleaseConflict[];
    actions: ChangeOrderActionTask[];
    impactUsedIn: ChangeOrderImpactItem[];
  }>(path.to.changeOrder(id));
  const changeOrder = routeData?.changeOrder;

  if (!changeOrder) throw new Error("Could not find change order data");

  const isDisabled = !canEditChangeOrder(changeOrder.status);

  return (
    <ChangeOrderWorkspace
      id={id}
      changeOrder={changeOrder}
      affectedItems={routeData?.affectedItems ?? []}
      actions={routeData?.actions ?? []}
      impactUsedIn={routeData?.impactUsedIn ?? []}
      releaseConflicts={routeData?.releaseConflicts ?? []}
      isDisabled={isDisabled}
    />
  );
}
