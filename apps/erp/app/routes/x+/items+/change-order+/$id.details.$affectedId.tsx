import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ChangeOrder } from "~/modules/items";
import { canEditChangeOrder } from "~/modules/items";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeOrder";
import AffectedItemDetail from "~/modules/items/ui/ChangeOrder/AffectedItemDetail";
import { path } from "~/utils/path";

// The selected affected item, addressed by the URL (not client state). Its data
// comes from the parent $id loader (useRouteData) — the URL only decides which
// affected item to show, so refresh + back/forward reselect it.
export default function ChangeOrderAffectedItemRoute() {
  const { id, affectedId } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    affectedItems: AffectedItemDraft[];
  }>(path.to.changeOrder(id));

  const changeOrder = routeData?.changeOrder;
  if (!changeOrder) throw new Error("Could not find change order data");

  const affected =
    routeData?.affectedItems.find((a) => a.affectedItem.id === affectedId) ??
    null;

  if (!affected) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <Trans>Affected item not found.</Trans>
      </div>
    );
  }

  const isDisabled = !canEditChangeOrder(changeOrder.status);

  return (
    <AffectedItemDetail
      key={affected.affectedItem.id}
      changeOrderId={id}
      affected={affected}
      isDisabled={isDisabled}
    />
  );
}
