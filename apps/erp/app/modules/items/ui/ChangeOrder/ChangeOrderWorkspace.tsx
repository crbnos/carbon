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
import ChangeOrderStatusFlow from "./ChangeOrderStatusFlow";

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

      {/* Middle shell: the always-visible top region (stage flow now, actions
          added by Task 5) sits above the scrollable per-item detail Outlet. */}
      <div className="flex-grow h-full flex flex-col overflow-hidden">
        <div className="flex-shrink-0 border-b border-border px-2 py-2">
          <ChangeOrderStatusFlow status={changeOrder.status} />
        </div>
        <div className="flex-grow overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent p-2">
          <Outlet />
        </div>
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
