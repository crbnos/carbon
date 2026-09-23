import {
  Button,
  DatePicker,
  IconButton,
  type JSONContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useDebounce
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { LuCalendar, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  ActionTaskCard,
  type ActionTaskStatus
} from "~/components/ActionTasks/ActionTaskCard";
import { ActionTaskStatusButton } from "~/components/ActionTasks/ActionTaskStatusButton";
import { JiraIssueDialog } from "~/components/ActionTasks/Jira/IssueDialog";
import { LinearIssueDialog } from "~/components/ActionTasks/Linear/IssueDialog";
import { syncActionTaskNotes } from "~/components/ActionTasks/syncNotes";
import { useDateFormatter, useImageUpload, usePermissions } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { canEditChangeNoticeActionTaskFields } from "../../items.models";
import type { ChangeNoticeActionTask, ChangeNoticeStatus } from "../../types";

// The shared Change Notice task wrapper owns only task-field persistence. The
// Change Notice overview and the Impact workspace can therefore render the same
// task editor without sharing workflow operations such as reconciliation,
// ordering, or deletion.
export function ChangeNoticeActionTaskItem({
  changeOrderId,
  changeNoticeStatus,
  action,
  canEditWorkflow,
  dragControls,
  headerExtras,
  onTaskMutation,
  showIntegrations = true,
  showDelete = true
}: {
  changeOrderId: string;
  changeNoticeStatus: ChangeNoticeStatus;
  action: ChangeNoticeActionTask;
  canEditWorkflow: boolean;
  dragControls?: DragControls;
  headerExtras?: ReactNode;
  onTaskMutation?: () => void;
  showIntegrations?: boolean;
  showDelete?: boolean;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const integrations = useIntegrations();
  const statusFetcher = useFetcher<{ success: boolean }>();
  const notesFetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  const [content, setContent] = useState((action.notes ?? {}) as JSONContent);
  const status = (action.status ?? "Pending") as ActionTaskStatus;
  const canEditTaskFields =
    permissions.can("update", "parts") &&
    canEditChangeNoticeActionTaskFields(changeNoticeStatus, action.taskOrigin);
  const canDelete =
    showDelete && permissions.can("delete", "parts") && canEditWorkflow;
  const pendingNotes = useRef<JSONContent | null>(null);

  // Shared uploader: converts HEIC before storing and lands the file under
  // `{companyId}/parts/…`, the same handler the Change Notice content editor and
  // the Issue action tasks use.
  const onUploadImage = useImageUpload("parts");

  useEffect(() => {
    if (
      statusFetcher.state !== "idle" ||
      statusFetcher.data?.success !== true
    ) {
      return;
    }
    onTaskMutation?.();
  }, [onTaskMutation, statusFetcher.data, statusFetcher.state]);

  const hasLinearLink = !!action.linearIssue;
  const hasJiraLink = !!action.jiraIssue;

  const syncLinkedNotes = useCallback(
    async (value: JSONContent) => {
      if (hasLinearLink) {
        await syncActionTaskNotes("Linear", {
          actionId: action.id,
          entityType: "changeOrderActionTask",
          notes: value
        });
      }

      if (hasJiraLink) {
        await syncActionTaskNotes("Jira", {
          actionId: action.id,
          entityType: "changeOrderActionTask",
          notes: value
        });
      }
    },
    [action.id, hasJiraLink, hasLinearLink]
  );

  useEffect(() => {
    if (notesFetcher.state !== "idle" || notesFetcher.data?.success !== true) {
      return;
    }

    const notes = pendingNotes.current;
    if (!notes) return;

    pendingNotes.current = null;
    void syncLinkedNotes(notes);
  }, [notesFetcher.data, notesFetcher.state, syncLinkedNotes]);

  const onUpdateContent = useDebounce(
    (value: JSONContent) => {
      pendingNotes.current = value;
      const formData = new FormData();
      formData.append("id", action.id);
      formData.append("notes", JSON.stringify(value));
      notesFetcher.submit(formData, {
        method: "post",
        action: path.to.changeNoticeActionNotes(changeOrderId, action.id)
      });
    },
    2500,
    true
  );

  const onStatusChange = (next: ActionTaskStatus) => {
    if (!canEditTaskFields) return;
    const formData = new FormData();
    formData.append("id", action.id);
    formData.append("status", next);
    statusFetcher.submit(formData, {
      method: "post",
      action: path.to.changeNoticeActionStatus(changeOrderId, action.id)
    });
  };

  const onDelete = () => {
    if (!canEditWorkflow) return;
    deleteFetcher.submit(
      {},
      {
        method: "post",
        action: path.to.deleteChangeNoticeAction(changeOrderId, action.id)
      }
    );
  };

  return (
    <ActionTaskCard
      title={action.name ?? ""}
      status={status}
      notes={content}
      canEditNotes={canEditTaskFields}
      onNotesChange={(value) => {
        setContent(value);
        onUpdateContent(value);
      }}
      onUploadImage={onUploadImage}
      onStatusChange={onStatusChange}
      assigneeTable="changeOrderActionTask"
      assigneeId={action.id}
      assignee={action.assignee ?? undefined}
      assignmentAction={path.to.changeNoticeActionAssignee(
        changeOrderId,
        action.id
      )}
      isDisabled={!canEditTaskFields}
      showDragHandle={canEditWorkflow}
      dragControls={dragControls}
      statusBadge={
        <ActionTaskStatusButton
          status={status}
          onChange={onStatusChange}
          isDisabled={!canEditTaskFields}
        />
      }
      headerExtras={
        <>
          {headerExtras}
          {showIntegrations && integrations.has("linear") && (
            <LinearIssueDialog
              entityType="changeOrderActionTask"
              taskId={action.id}
              linkedIssue={action.linearIssue}
            />
          )}
          {showIntegrations && integrations.has("jira") && (
            <JiraIssueDialog
              entityType="changeOrderActionTask"
              taskId={action.id}
              linkedIssue={action.jiraIssue}
            />
          )}
          {canDelete && (
            <IconButton
              aria-label={t`Delete action`}
              icon={<LuTrash2 />}
              variant="ghost"
              onClick={onDelete}
              isDisabled={deleteFetcher.state !== "idle"}
            />
          )}
        </>
      }
      footerExtras={
        <ChangeNoticeActionTaskDueDate
          changeOrderId={changeOrderId}
          task={action}
          isDisabled={!canEditTaskFields}
          onTaskMutation={onTaskMutation}
        />
      }
    />
  );
}

export function ChangeNoticeActionTaskDueDate({
  changeOrderId,
  task,
  isDisabled,
  onTaskMutation
}: {
  changeOrderId: string;
  task: ChangeNoticeActionTask;
  isDisabled: boolean;
  onTaskMutation?: () => void;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const [isOpen, setIsOpen] = useState(false);
  const permissions = usePermissions();
  const fetcher = useFetcher<{ success: boolean }>();
  const canEdit = permissions.can("update", "parts") && !isDisabled;
  const pendingValue = fetcher.formData?.get("dueDate") ?? task.dueDate;

  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data?.success !== true) return;
    onTaskMutation?.();
  }, [fetcher.data, fetcher.state, onTaskMutation]);

  const handleDateChange = (date: string | null) => {
    fetcher.submit(
      {
        id: task.id,
        dueDate: date || ""
      },
      {
        method: "post",
        action: path.to.changeNoticeActionDueDate(changeOrderId, task.id)
      }
    );
  };

  if (!canEdit) {
    return (
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<LuCalendar />}
        isDisabled
      >
        <span>{task.dueDate ? formatDate(task.dueDate) : t`No due date`}</span>
      </Button>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger disabled={isDisabled} asChild>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuCalendar />}
          isDisabled={isDisabled || fetcher.state !== "idle"}
        >
          {pendingValue ? formatDate(String(pendingValue)) : t`Due Date`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-2">
          <DatePicker
            value={pendingValue ? parseDate(String(pendingValue)) : null}
            onChange={(date) => handleDateChange(date?.toString() || null)}
          />
          {pendingValue && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDateChange(null)}
              className="w-full"
              isDisabled={fetcher.state !== "idle"}
            >
              <Trans>Clear due date</Trans>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
