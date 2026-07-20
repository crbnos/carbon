import { useCarbon } from "@carbon/auth";
import {
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
import { ActionTaskStatusButton } from "~/components/ActionTasks/ActionTaskStatusButton";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { ListItem } from "~/types";
import { getPrivateUrl, path } from "~/utils/path";
import type { ChangeOrderActionTask } from "../../types";

// Change-order actions — a thin wrapper over the shared ActionTaskList (same
// component the Quality issue uses). Adding picks from the change order's
// configured required-action templates via the "Add Actions" modal and writes
// back through the reconcile route (`$id.action`), which instantiates the union
// of the current tasks and the newly-picked templates. Each row is an ActionItem
// (notes, status, assignee) with an inline delete. All actions live here on the
// top-level detail route.
export default function ChangeOrderActions({
  changeOrderId,
  actions,
  isDisabled
}: {
  changeOrderId: string;
  actions: ChangeOrderActionTask[];
  isDisabled: boolean;
}) {
  const routeData = useRouteData<{ requiredActions: ListItem[] }>(
    path.to.changeOrder(changeOrderId)
  );
  const addFetcher = useFetcher<{ success: boolean }>();

  // The reconcile route (`setChangeOrderActionTasks`) sets the exact set of
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
        action: path.to.changeOrderAction(changeOrderId)
      });
    },
    [actions, changeOrderId, addFetcher]
  );

  return (
    <ActionTaskList
      tasks={actions}
      reorderAction={path.to.changeOrderActionOrder(changeOrderId)}
      templates={routeData?.requiredActions ?? []}
      onAdd={onAdd}
      isAddSubmitting={addFetcher.state !== "idle"}
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
// (notes via supabase, status + delete via CO routes) and passes the due date
// into the card's slots.
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

  const onDelete = () => {
    if (isDisabled) return;
    deleteFetcher.submit(
      {},
      {
        method: "post",
        action: path.to.deleteChangeOrderAction(changeOrderId, action.id)
      }
    );
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
      statusBadge={
        <ActionTaskStatusButton
          status={status}
          onChange={onStatusChange}
          isDisabled={isDisabled}
        />
      }
      headerExtras={
        canEdit ? (
          <IconButton
            aria-label={t`Delete action`}
            icon={<LuTrash2 />}
            variant="ghost"
            onClick={onDelete}
            isDisabled={deleteFetcher.state !== "idle"}
          />
        ) : undefined
      }
      footerExtras={
        action.dueDate ? (
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
            {action.dueDate}
          </span>
        ) : undefined
      }
    />
  );
}
