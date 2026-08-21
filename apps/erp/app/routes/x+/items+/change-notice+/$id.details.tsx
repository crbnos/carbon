import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ChangeNotice, ChangeNoticeActionTask } from "~/modules/items";
import {
  canEditChangeNoticeEngineering,
  canEditChangeNoticeWorkflow
} from "~/modules/items";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeNotice";
import {
  ChangeNoticeActions,
  ChangeNoticeChanges,
  ChangeNoticeContent
} from "~/modules/items/ui/ChangeNotice";
import ChangeNoticeStatusFlow from "~/modules/items/ui/ChangeNotice/ChangeNoticeStatusFlow";
import { path } from "~/utils/path";

// Top-level change-order detail (the CO overview) — mirrors the sales order
// `$orderId.details` and the quality issue `$id.details`: the CO-wide state flow,
// the two rich-text narrative fields (reason for change + description, edited the
// same way as the issue's description), the total changes rollup (every affected
// item's authoring diff), and the action tasks (with the shared "Add Actions"
// picker). Affected items live in their own line routes (`$id.$affectedId.details`),
// linked from the explorer.
export default function ChangeNoticeDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeNotice: ChangeNotice;
    actions: ChangeNoticeActionTask[];
    affectedItems: AffectedItemDraft[];
  }>(path.to.changeNotice(id));
  const changeNotice = routeData?.changeNotice;

  if (!changeNotice) throw new Error("Could not find change notice data");

  const isDisabled = !canEditChangeNoticeEngineering(changeNotice.status);
  // Action tasks are workflow content — executing them is what Implementation is for.
  const isWorkflowDisabled = !canEditChangeNoticeWorkflow(changeNotice.status);

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
    <VStack spacing={4} className="p-4">
      <ChangeNoticeStatusFlow status={changeNotice.status} />
      <ChangeNoticeChanges changes={changes} />
      <ChangeNoticeContent
        id={id}
        reasonForChange={changeNotice.reasonForChange as JSONContent}
        description={changeNotice.description as JSONContent}
        isDisabled={isDisabled}
      />
      <ChangeNoticeActions
        changeOrderId={id}
        actions={routeData?.actions ?? []}
        isDisabled={isWorkflowDisabled}
      />
    </VStack>
  );
}
