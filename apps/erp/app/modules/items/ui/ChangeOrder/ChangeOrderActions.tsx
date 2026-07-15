import { useCarbon } from "@carbon/auth";
import {
  Badge,
  IconButton,
  type JSONContent,
  toast,
  useDebounce
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { nanoid } from "nanoid";
import { useCallback, useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  ActionTaskCard,
  type ActionTaskStatus
} from "~/components/ActionTasks/ActionTaskCard";
import { ActionTaskList } from "~/components/ActionTasks/ActionTaskList";
import { ActionTaskProgress } from "~/components/ActionTasks/ActionTaskProgress";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { ListItem } from "~/types";
import { getPrivateUrl, path } from "~/utils/path";
import type { ChangeOrderActionTask } from "../../types";

export default function ChangeOrderActions({
  changeOrderId,
  actions,
  isDisabled,
  variant = "full"
}: {
  changeOrderId: string;
  actions: ChangeOrderActionTask[];
  isDisabled: boolean;
  // "full" = the shared action-task list at the top of the middle pane.
  // "summary" = just the progress bar (the compact right-rail view).
  variant?: "full" | "summary";
}) {
  const routeData = useRouteData<{ requiredActions: ListItem[] }>(
    path.to.changeOrder(changeOrderId)
  );
  const { t } = useLingui();
  const addFetcher = useFetcher<{ success: boolean }>();

  const onAdd = useCallback(
    (selectedIds: string[]) => {
      const formData = new FormData();
      formData.append("actionIds", selectedIds.join(","));
      addFetcher.submit(formData, {
        method: "post",
        action: path.to.changeOrderAction(changeOrderId)
      });
    },
    [changeOrderId, addFetcher]
  );

  if (variant === "summary") {
    return actions.length > 0 ? <ActionTaskProgress tasks={actions} /> : null;
  }

  return (
    <ActionTaskList
      tasks={actions}
      reorderAction={path.to.changeOrderActionOrder(changeOrderId)}
      templates={routeData?.requiredActions ?? []}
      onAdd={onAdd}
      isAddSubmitting={addFetcher.state !== "idle"}
      addEmptyMessage={t`No action templates configured. Add them under Change Order Actions.`}
      isDisabled={isDisabled}
      renderItem={(action, dragControls) => (
        <ActionItem
          changeOrderId={changeOrderId}
          action={action}
          isDisabled={isDisabled}
          dragControls={dragControls}
        />
      )}
    />
  );
}

// The CO wrapper over the shared ActionTaskCard: owns CO-specific persistence
// (notes via supabase, status + delete via CO routes) and passes the delete
// affordance + due date into the card's slots.
function ActionItem({
  changeOrderId,
  action,
  isDisabled,
  dragControls
}: {
  changeOrderId: string;
  action: ChangeOrderActionTask;
  isDisabled: boolean;
  dragControls: DragControls;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();
  const statusFetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  const [content, setContent] = useState((action.notes ?? {}) as JSONContent);
  const status = (action.status ?? "Pending") as ActionTaskStatus;
  const canEdit = permissions.can("update", "parts") && !isDisabled;

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;
    const result = await carbon?.storage.from("private").upload(fileName, file);
    if (result?.error || !result?.data) {
      toast.error(t`Failed to upload image`);
      throw new Error(result?.error?.message ?? "Failed to upload image");
    }
    return getPrivateUrl(result.data.path);
  };

  const onUpdateContent = useDebounce(
    async (value: JSONContent) => {
      await carbon
        ?.from("changeOrderActionTask")
        .update({ notes: value, updatedBy: userId })
        .eq("id", action.id);
    },
    2500,
    true
  );

  const onStatusChange = (next: ActionTaskStatus) => {
    if (isDisabled) return;
    const formData = new FormData();
    formData.append("id", action.id);
    formData.append("status", next);
    statusFetcher.submit(formData, {
      method: "post",
      action: path.to.changeOrderActionStatus(changeOrderId, action.id)
    });
  };

  return (
    <ActionTaskCard
      title={action.name ?? ""}
      status={status}
      notes={content}
      canEditNotes={canEdit}
      onNotesChange={(value) => {
        setContent(value);
        onUpdateContent(value);
      }}
      onUploadImage={onUploadImage}
      onStatusChange={onStatusChange}
      assigneeTable="changeOrderActionTask"
      assigneeId={action.id}
      assignee={action.assignee ?? undefined}
      isDisabled={isDisabled}
      showDragHandle={!isDisabled}
      dragControls={dragControls}
      statusBadge={<Badge variant="secondary">{status}</Badge>}
      headerExtras={
        !isDisabled ? (
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteChangeOrderAction(changeOrderId, action.id)}
          >
            <IconButton
              type="submit"
              aria-label={t`Remove action`}
              variant="ghost"
              icon={<LuTrash2 />}
            />
          </deleteFetcher.Form>
        ) : undefined
      }
      footerExtras={
        action.dueDate ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {action.dueDate}
          </span>
        ) : undefined
      }
    />
  );
}
