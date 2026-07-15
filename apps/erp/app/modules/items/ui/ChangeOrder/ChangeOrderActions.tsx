import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  IconButton,
  type JSONContent,
  toast,
  useDebounce
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { nanoid } from "nanoid";
import { useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { z } from "zod";
import {
  ActionTaskCard,
  type ActionTaskStatus
} from "~/components/ActionTasks/ActionTaskCard";
import { ActionTaskList } from "~/components/ActionTasks/ActionTaskList";
import { ActionTaskStatusButton } from "~/components/ActionTasks/ActionTaskStatusButton";
import { MultiSelect } from "~/components/Form";
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
  // "full" = the shared action-task list in the middle pane. Change Orders are
  // seeded from configured templates on create, so there is deliberately no
  // "Add Actions" affordance here (no `onAdd` passed to the list).
  // "summary" = the right-rail read-only list of the selected actions.
  variant?: "full" | "summary";
}) {
  if (variant === "summary") {
    return (
      <ChangeOrderRequiredActions
        changeOrderId={changeOrderId}
        actions={actions}
        isDisabled={isDisabled}
      />
    );
  }

  // Actions are chosen from the right rail; with none selected there's nothing
  // to show in the middle, so drop the card entirely (no empty shell).
  if (actions.length === 0) return null;

  return (
    <ActionTaskList
      tasks={actions}
      reorderAction={path.to.changeOrderActionOrder(changeOrderId)}
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

// The right-rail "Required Actions" picker — an inline multiselect of the
// configured templates, mirroring the Quality issue sidebar. Selecting a
// template instantiates its action task; deselecting removes it (both reconciled
// by the $id.action route, keyed by the task's actionTypeId).
function ChangeOrderRequiredActions({
  changeOrderId,
  actions,
  isDisabled
}: {
  changeOrderId: string;
  actions: ChangeOrderActionTask[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const routeData = useRouteData<{ requiredActions: ListItem[] }>(
    path.to.changeOrder(changeOrderId)
  );
  const fetcher = useFetcher<{ success: boolean }>();

  // While a select/deselect is in flight, reflect the submitted set immediately —
  // the `actions` prop only updates after the reconcile revalidates. Without this
  // optimistic read the chip flickers (added → reset to stale → re-added).
  const pending = fetcher.formData?.get("actionIds");
  const selected =
    pending != null
      ? String(pending).split(",").filter(Boolean)
      : actions
          .map((a) => a.actionTypeId)
          .filter((id): id is string => Boolean(id));

  return (
    <ValidatedForm
      defaultValues={{ requiredActionIds: selected }}
      validator={z.object({
        requiredActionIds: z.array(z.string()).optional()
      })}
      className="w-full"
    >
      <MultiSelect
        name="requiredActionIds"
        label={t`Required Actions`}
        isReadOnly={isDisabled}
        inline
        value={selected}
        options={(routeData?.requiredActions ?? []).map((a) => ({
          value: a.id,
          label: a.name
        }))}
        onChange={(value) => {
          const formData = new FormData();
          formData.append("actionIds", value.map((v) => v.value).join(","));
          fetcher.submit(formData, {
            method: "post",
            action: path.to.changeOrderAction(changeOrderId)
          });
        }}
      />
    </ValidatedForm>
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
      statusBadge={
        <ActionTaskStatusButton
          status={status}
          onChange={onStatusChange}
          isDisabled={isDisabled}
        />
      }
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
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
            {action.dueDate}
          </span>
        ) : undefined
      }
    />
  );
}
