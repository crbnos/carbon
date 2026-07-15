import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  type JSONContent,
  toast,
  useDebounce,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { Reorder, useDragControls } from "framer-motion";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { ActionTaskAddModal } from "~/components/ActionTasks/ActionTaskAddModal";
import {
  ActionTaskCard,
  type ActionTaskStatus
} from "~/components/ActionTasks/ActionTaskCard";
import { usePermissions, useRouteData, useUser } from "~/hooks";
// Reuse Quality's progress bar (entity-agnostic: { status }[]) so the CO actions
// look identical to an issue's — no second copy of the progress widget.
import { TaskProgress } from "~/modules/quality/ui/Issue/IssueTask";
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
  // "full" = the Card with title + progress + reorderable list + add modal (the
  // primary surface, at the top of the middle pane). "summary" = just the
  // progress bar (the compact right-rail view).
  variant?: "full" | "summary";
}) {
  const orderFetcher = useFetcher<{ success: boolean }>();

  const [sortOrder, setSortOrder] = useState<string[]>(() =>
    [...actions]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((a) => a.id)
  );

  useEffect(() => {
    setSortOrder(
      [...actions]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((a) => a.id)
    );
  }, [actions]);

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      const formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      orderFetcher.submit(formData, {
        method: "post",
        action: path.to.changeOrderActionOrder(changeOrderId)
      });
    },
    1000,
    true
  );

  const onReorder = (newOrder: string[]) => {
    if (isDisabled) return;
    const updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      updates[id] = index + 1;
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  // Rail summary: just the progress bar (the full list lives in the middle pane).
  if (variant === "summary") {
    return actions.length > 0 ? <TaskProgress tasks={actions} /> : null;
  }

  return (
    <Card className="w-full" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle>
            <Trans>Actions</Trans>
          </CardTitle>
        </CardHeader>
        {actions.length > 0 && <TaskProgress tasks={actions} />}
      </HStack>
      <CardContent>
        <VStack spacing={3}>
          {actions.length > 0 && (
            <Reorder.Group
              axis="y"
              values={sortOrder}
              onReorder={onReorder}
              className="w-full space-y-3"
            >
              {sortOrder.map((id) => {
                const action = actions.find((a) => a.id === id);
                if (!action) return null;
                return (
                  <ReorderableActionItem
                    key={id}
                    changeOrderId={changeOrderId}
                    action={action}
                    isDisabled={isDisabled}
                  />
                );
              })}
            </Reorder.Group>
          )}

          {!isDisabled && <NewAction changeOrderId={changeOrderId} />}
        </VStack>
      </CardContent>
    </Card>
  );
}

function ReorderableActionItem({
  changeOrderId,
  action,
  isDisabled
}: {
  changeOrderId: string;
  action: ChangeOrderActionTask;
  isDisabled: boolean;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      value={action.id}
      dragListener={false}
      dragControls={dragControls}
    >
      <ActionItem
        changeOrderId={changeOrderId}
        action={action}
        isDisabled={isDisabled}
        dragControls={dragControls}
      />
    </Reorder.Item>
  );
}

// Thin CO wrapper over the shared ActionTaskCard: owns CO-specific persistence
// (notes via supabase, status + reorder + delete via CO routes) and passes the
// delete affordance + due date into the card's slots.
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

// CO "Add Actions": the shared dashed-button + template-picker modal, wired to
// the CO required-action templates + the CO action route.
function NewAction({ changeOrderId }: { changeOrderId: string }) {
  const { t } = useLingui();
  const routeData = useRouteData<{ requiredActions: ListItem[] }>(
    path.to.changeOrder(changeOrderId)
  );
  const fetcher = useFetcher<{ success: boolean }>();

  const onAdd = useCallback(
    (selectedIds: string[]) => {
      const formData = new FormData();
      formData.append("actionIds", selectedIds.join(","));
      fetcher.submit(formData, {
        method: "post",
        action: path.to.changeOrderAction(changeOrderId)
      });
    },
    [changeOrderId, fetcher]
  );

  return (
    <ActionTaskAddModal
      templates={routeData?.requiredActions ?? []}
      onAdd={onAdd}
      isSubmitting={fetcher.state !== "idle"}
      emptyMessage={t`No action templates configured. Add them under Change Order Actions.`}
    />
  );
}
