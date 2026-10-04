// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { useParams } from "react-router";
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
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    requiredActions: ListItem[];
    nonConformance: { requiredActionIds: string[] | null };
  }>(path.to.issue(id));
  const addFetcher = useAction<{ error: { message: string } | null }>({
    onError: (data) => {
      if (data?.error) {
        toast.error(data.error.message);
      }
    }
  });

  const existingIds = routeData?.nonConformance?.requiredActionIds ?? [];

  const onAdd = useCallback(
    (selectedIds: string[]) => {
      // bulkUpdateIssue REPLACES requiredActionIds, so send existing + new.
      const merged = Array.from(new Set([...existingIds, ...selectedIds]));
      const formData = new FormData();
      formData.append("ids", id);
      formData.append("field", "requiredActionIds");
      formData.append("value", merged.join(","));
      addFetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateIssue
      });
    },
    [id, addFetcher, existingIds]
  );

  return (
    <ActionTaskList
      tasks={tasks}
      reorderAction={path.to.issueActionTasksOrder}
      templates={(routeData?.requiredActions ?? []).filter(
        (a) => !existingIds.includes(a.id)
      )}
      addEmptyMessage={t`Every required action has already been added.`}
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
