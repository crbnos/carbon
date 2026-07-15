import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  generateHTML,
  HStack,
  IconButton,
  type JSONContent,
  toast,
  useDebounce,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { Reorder, useDragControls } from "framer-motion";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import {
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuGripVertical,
  LuLoaderCircle,
  LuTrash2
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Assignee } from "~/components";
import { DatePicker, Employee, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
// Reuse Quality's progress bar (entity-agnostic: { status }[]) so the CO actions
// look identical to an issue's — no second copy of the progress widget.
import { TaskProgress } from "~/modules/quality/ui/Issue/IssueTask";
import { getPrivateUrl, path } from "~/utils/path";
import { changeOrderActionValidator } from "../../changeOrder.models";
import type { ChangeOrderActionTask } from "../../types";

// Next status on the Start/Complete/Reopen button, mirroring Quality.
const statusActions = {
  Pending: { action: "Start", icon: <LuCirclePlay />, next: "In Progress" },
  "In Progress": {
    action: "Complete",
    icon: <LuCircleCheck />,
    next: "Completed"
  },
  Completed: { action: "Reopen", icon: <LuLoaderCircle />, next: "Pending" },
  Skipped: { action: "Reopen", icon: <LuLoaderCircle />, next: "Pending" }
} as const;

export default function ChangeOrderActions({
  changeOrderId,
  actions,
  isDisabled,
  variant = "full"
}: {
  changeOrderId: string;
  actions: ChangeOrderActionTask[];
  isDisabled: boolean;
  // "full" = the Card with title + progress + reorderable list + add form (the
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

// Mirrors Quality's TaskItem: a bordered card with the title + drag/delete/toggle
// on top, a collapsible rich-text notes editor, and a bottom bar carrying the
// status badge, assignee, due date, and the Start/Complete/Reopen action.
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
  const disclosure = useDisclosure({ defaultIsOpen: true });
  const statusFetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  const [content, setContent] = useState((action.notes ?? {}) as JSONContent);

  const status = (action.status ?? "Pending") as keyof typeof statusActions;
  const statusAction = statusActions[status];
  const isComplete = status === "Completed" || status === "Skipped";
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

  const onStatusChange = () => {
    if (isDisabled) return;
    const formData = new FormData();
    formData.append("id", action.id);
    formData.append("status", statusAction.next);
    statusFetcher.submit(formData, {
      method: "post",
      action: path.to.changeOrderActionStatus(changeOrderId, action.id)
    });
  };

  return (
    <div className="rounded-lg border w-full flex flex-col bg-card">
      <div className="flex w-full justify-between px-4 py-2 items-center">
        <span
          className={cn(
            "text-base font-semibold tracking-tight",
            isComplete && "line-through text-muted-foreground"
          )}
        >
          {action.name}
        </span>
        <div className="flex items-center gap-1">
          {!isDisabled && (
            <button
              type="button"
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors p-1"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <LuGripVertical size={16} />
            </button>
          )}
          {!isDisabled && (
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
          )}
          <IconButton
            icon={<LuChevronRight />}
            variant="ghost"
            onClick={disclosure.onToggle}
            aria-label={t`Open action details`}
            className={cn(disclosure.isOpen && "rotate-90")}
          />
        </div>
      </div>

      {disclosure.isOpen && (
        <div className="px-4 py-2 rounded">
          {canEdit ? (
            <Editor
              className="w-full min-h-[100px]"
              initialValue={content}
              onUpload={onUploadImage}
              onChange={(value) => {
                setContent(value);
                onUpdateContent(value);
              }}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: read-only render of stored notes
              dangerouslySetInnerHTML={{
                __html: generateHTML(content as JSONContent)
              }}
            />
          )}
        </div>
      )}

      <div className="bg-muted/30 border-t px-4 py-2 flex justify-between w-full">
        <HStack>
          <Badge variant="secondary">{status}</Badge>
          <Assignee
            table="changeOrderActionTask"
            id={action.id}
            size="sm"
            value={action.assignee ?? undefined}
            disabled={isDisabled}
          />
          {action.dueDate && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {action.dueDate}
            </span>
          )}
        </HStack>
        <HStack>
          <Button
            isDisabled={isDisabled}
            leftIcon={statusAction.icon}
            variant="secondary"
            size="sm"
            onClick={onStatusChange}
          >
            {statusAction.action}
          </Button>
        </HStack>
      </div>
    </div>
  );
}

function NewAction({ changeOrderId }: { changeOrderId: string }) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderAction(changeOrderId)}
      validator={changeOrderActionValidator}
      defaultValues={{
        changeOrderId,
        name: "",
        assignee: "",
        dueDate: ""
      }}
      className="w-full"
      resetAfterSubmit
    >
      <Hidden name="changeOrderId" value={changeOrderId} />
      <VStack spacing={2} className="w-full">
        <Input name="name" label={t`New action`} />
        <Employee name="assignee" label={t`Assignee`} />
        <DatePicker name="dueDate" label={t`Due date`} />
        <HStack className="w-full justify-end">
          <Submit>
            <Trans>Add</Trans>
          </Submit>
        </HStack>
      </VStack>
    </ValidatedForm>
  );
}
