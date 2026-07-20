import { useCallback } from "react";
import { useFetcher, useParams } from "react-router";
import { ActionTaskList } from "~/components/ActionTasks/ActionTaskList";
import { useRouteData } from "~/hooks";
import type { IssueActionTask } from "~/modules/quality";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { TaskItem } from "./IssueTask";

// Issue actions — a thin wrapper over the shared ActionTaskList. Each row is an
// issue TaskItem (Linear/Jira, processes, supplier, notes); adding picks from the
// issue's required actions and writes back via bulkUpdateIssue.
export function ActionTasksList({
  tasks,
  suppliers,
  isDisabled
}: {
  tasks: IssueActionTask[];
  suppliers: { supplierId: string; externalLinkId: string | null }[];
  isDisabled: boolean;
}) {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{ requiredActions: ListItem[] }>(
    path.to.issue(id)
  );
  const addFetcher = useFetcher();

  const onAdd = useCallback(
    (selectedIds: string[]) => {
      const formData = new FormData();
      formData.append("ids", id);
      formData.append("field", "requiredActionIds");
      formData.append("value", selectedIds.join(","));
      addFetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateIssue
      });
    },
    [id, addFetcher]
  );

  return (
    <ActionTaskList
      tasks={tasks}
      reorderAction={path.to.issueActionTasksOrder}
      templates={routeData?.requiredActions ?? []}
      onAdd={onAdd}
      isAddSubmitting={addFetcher.state !== "idle"}
      isDisabled={isDisabled}
      renderItem={(task, dragControls) => (
        <TaskItem
          task={task}
          type="action"
          suppliers={suppliers}
          isDisabled={isDisabled}
          showDragHandle
          dragControls={dragControls}
        />
      )}
    />
  );
}
