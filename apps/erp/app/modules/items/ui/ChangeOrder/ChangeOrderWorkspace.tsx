import { Outlet } from "react-router";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderImpact,
  ChangeOrderReleaseConflict
} from "~/modules/items";
import AffectedItemsSidebar from "./AffectedItemsSidebar";
import type { AffectedItemDraft } from "./affectedItem.types";
import ChangeOrderRail from "./ChangeOrderRail";

// The 3-pane change-order workspace shell: left = affected-items list, middle =
// the selected item's detail (an <Outlet> — the selection lives in the URL, not
// client state, so refresh + back/forward reselect it), right = the CO-centric
// rail. The middle child route ($id.details.$affectedId) renders the detail.
export default function ChangeOrderWorkspace({
  id,
  changeOrder,
  affectedItems,
  actions,
  impact,
  releaseConflicts,
  isDisabled,
  showImplementation
}: {
  id: string;
  changeOrder: ChangeOrder;
  affectedItems: AffectedItemDraft[];
  actions: ChangeOrderActionTask[];
  impact: ChangeOrderImpact;
  releaseConflicts: ChangeOrderReleaseConflict[];
  isDisabled: boolean;
  showImplementation: boolean;
}) {
  return (
    <div className="flex h-[calc(100dvh-99px)] w-full overflow-hidden">
      <AffectedItemsSidebar
        changeOrderId={id}
        affectedItems={affectedItems}
        isDisabled={isDisabled}
      />

      <div className="flex-grow h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent p-2">
        <Outlet />
      </div>

      <ChangeOrderRail
        id={id}
        changeOrder={changeOrder}
        affectedItems={affectedItems}
        actions={actions}
        impact={impact}
        releaseConflicts={releaseConflicts}
        isDisabled={isDisabled}
        showImplementation={showImplementation}
      />
    </div>
  );
}
