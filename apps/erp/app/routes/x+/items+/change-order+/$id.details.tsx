import { VStack } from "@carbon/react";
import { Outlet, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ChangeOrder, ChangeOrderActionTask } from "~/modules/items";
import { canEditChangeOrder } from "~/modules/items";
import { ChangeOrderActions } from "~/modules/items/ui/ChangeOrder";
import ChangeOrderStatusFlow from "~/modules/items/ui/ChangeOrder/ChangeOrderStatusFlow";
import { path } from "~/utils/path";

// Content body of the change-order workspace (the middle panel): the CO-wide
// stage flow + actions sit above the selected affected item's detail (the
// URL-addressed <Outlet> — selection lives in the URL, not client state, so
// refresh + back/forward reselect it). Rendered inside the $id.tsx content
// panel's scroll container.
export default function ChangeOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    actions: ChangeOrderActionTask[];
  }>(path.to.changeOrder(id));
  const changeOrder = routeData?.changeOrder;

  if (!changeOrder) throw new Error("Could not find change order data");

  const isDisabled = !canEditChangeOrder(changeOrder.status);

  return (
    <VStack spacing={2} className="p-2">
      <ChangeOrderStatusFlow status={changeOrder.status} />
      <ChangeOrderActions
        variant="full"
        changeOrderId={id}
        actions={routeData?.actions ?? []}
        isDisabled={isDisabled}
      />
      <Outlet />
    </VStack>
  );
}
