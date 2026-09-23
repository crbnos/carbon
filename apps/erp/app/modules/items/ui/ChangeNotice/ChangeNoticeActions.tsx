import { useCallback } from "react";
import { useFetcher } from "react-router";
import { ActionTaskList } from "~/components/ActionTasks/ActionTaskList";
import { useRouteData } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import type { ChangeNoticeActionTask, ChangeNoticeStatus } from "../../types";
import { ChangeNoticeActionTaskItem } from "./ChangeNoticeActionTaskItem";

// Change-order actions — a thin wrapper over the shared ActionTaskList (same
// component the Quality issue uses). Adding picks from the change notice's
// configured required-action templates via the "Add Actions" modal and writes
// back through the reconcile route (`$id.action`), which instantiates the union
// of the current tasks and the newly-picked templates. Each row is a
// ChangeNoticeActionTaskItem (notes, status, assignee, due date) with an inline
// delete. All actions live here on the
// top-level detail route.
export default function ChangeNoticeActions({
  changeOrderId,
  changeNoticeStatus,
  actions,
  canEditWorkflow
}: {
  changeOrderId: string;
  changeNoticeStatus: ChangeNoticeStatus;
  actions: ChangeNoticeActionTask[];
  canEditWorkflow: boolean;
}) {
  const routeData = useRouteData<{ requiredActions: ListItem[] }>(
    path.to.changeNotice(changeOrderId)
  );
  const addFetcher = useFetcher<{ success: boolean }>();

  // The reconcile route (`setChangeNoticeActionTasks`) sets the exact set of
  // tasks from the posted actionTypeIds, so adding posts the union of the current
  // tasks' types and the newly-picked templates (removal is per-card, below).
  const onAdd = useCallback(
    (selectedIds: string[]) => {
      const existing = actions
        .map((a) => a.actionTypeId)
        .filter((id): id is string => Boolean(id));
      const merged = Array.from(new Set([...existing, ...selectedIds]));
      const formData = new FormData();
      formData.append("actionIds", merged.join(","));
      addFetcher.submit(formData, {
        method: "post",
        action: path.to.changeNoticeAction(changeOrderId)
      });
    },
    [actions, changeOrderId, addFetcher]
  );

  return (
    <ActionTaskList
      tasks={actions}
      reorderAction={path.to.changeNoticeActionOrder(changeOrderId)}
      templates={routeData?.requiredActions ?? []}
      onAdd={onAdd}
      isAddSubmitting={addFetcher.state !== "idle"}
      isDisabled={!canEditWorkflow}
      renderItem={(action, dragControls) => (
        <ChangeNoticeActionTaskItem
          changeOrderId={changeOrderId}
          changeNoticeStatus={changeNoticeStatus}
          action={action}
          canEditWorkflow={canEditWorkflow}
          dragControls={dragControls}
        />
      )}
    />
  );
}
