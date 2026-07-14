import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderImpact,
  ChangeOrderReleaseConflict
} from "~/modules/items";
import AffectedItemDetail from "./AffectedItemDetail";
import AffectedItemsSidebar from "./AffectedItemsSidebar";
import type { AffectedItemDraft } from "./affectedItem.types";
import ChangeOrderRail from "./ChangeOrderRail";

// The 3-pane change-order workspace: left = selectable affected-items list,
// middle = the selected item's detail (BoM/BoP/attributes/diff), right = the
// CO-centric rail. Selection is local state (defaults to the first item), the
// state-driven master-detail pattern used elsewhere (e.g. traceability graph).
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
  const [selectedId, setSelectedId] = useState<string | null>(
    affectedItems[0]?.affectedItem.id ?? null
  );

  // Keep the selection valid as items are added/removed: if the current pick is
  // gone, fall back to the first item (or nothing).
  useEffect(() => {
    const stillPresent = affectedItems.some(
      (a) => a.affectedItem.id === selectedId
    );
    if (!stillPresent) {
      setSelectedId(affectedItems[0]?.affectedItem.id ?? null);
    }
  }, [affectedItems, selectedId]);

  const selected =
    affectedItems.find((a) => a.affectedItem.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-99px)] w-full overflow-hidden">
      <AffectedItemsSidebar
        changeOrderId={id}
        affectedItems={affectedItems}
        selectedId={selectedId}
        onSelect={setSelectedId}
        isDisabled={isDisabled}
      />

      <div className="flex-grow h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent p-2">
        {selected ? (
          <AffectedItemDetail
            key={selected.affectedItem.id}
            changeOrderId={id}
            affected={selected}
            isDisabled={isDisabled}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            <Trans>Select an affected item, or add one on the left.</Trans>
          </div>
        )}
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
