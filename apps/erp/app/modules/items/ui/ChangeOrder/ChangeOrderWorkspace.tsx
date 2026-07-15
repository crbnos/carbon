import { VStack } from "@carbon/react";
import { Outlet } from "react-router";
import type { ChangeOrder, ChangeOrderActionTask } from "~/modules/items";
import AffectedItemsSidebar from "./AffectedItemsSidebar";
import type { AffectedItemDraft } from "./affectedItem.types";
import ChangeOrderActions from "./ChangeOrderActions";
import ChangeOrderRail from "./ChangeOrderRail";
import ChangeOrderStatusFlow from "./ChangeOrderStatusFlow";
import type { ChangeOrderImpactItem } from "./ImpactPanel";

// The 3-pane change-order workspace shell: left = affected-items list, middle =
// the selected item's detail (an <Outlet> — the selection lives in the URL, not
// client state, so refresh + back/forward reselect it), right = the CO-centric
// rail. The middle child route ($id.details.$affectedId) renders the detail.
export default function ChangeOrderWorkspace({
  id,
  changeOrder,
  affectedItems,
  actions,
  impactUsedIn,
  isDisabled
}: {
  id: string;
  changeOrder: ChangeOrder;
  affectedItems: AffectedItemDraft[];
  actions: ChangeOrderActionTask[];
  impactUsedIn: ChangeOrderImpactItem[];
  isDisabled: boolean;
}) {
  return (
    <div className="flex h-[calc(100dvh-99px)] w-full overflow-hidden">
      <AffectedItemsSidebar
        changeOrderId={id}
        affectedItems={affectedItems}
        isDisabled={isDisabled}
      />

      {/* Middle pane (scrolls as one, like the Quality issue detail): the
          CO-wide stage flow + actions sit at the top, above the selected
          affected item's detail (the URL-addressed <Outlet>). */}
      <div className="flex-grow h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent p-2">
        <VStack spacing={2}>
          <ChangeOrderStatusFlow status={changeOrder.status} />
          <ChangeOrderActions
            variant="full"
            changeOrderId={id}
            actions={actions}
            isDisabled={isDisabled}
          />
          <Outlet />
        </VStack>
      </div>

      <ChangeOrderRail
        id={id}
        changeOrder={changeOrder}
        affectedItems={affectedItems}
        actions={actions}
        impactUsedIn={impactUsedIn}
        isDisabled={isDisabled}
      />
    </div>
  );
}
