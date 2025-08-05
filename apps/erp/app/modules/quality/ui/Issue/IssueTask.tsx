import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  toast,
  useDebounce,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { useFetchers, useParams, useSubmit } from "@remix-run/react";
import { nanoid } from "nanoid";
import { useCallback, useRef, useState } from "react";
import {
  LuCalendar,
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuLoaderCircle,
} from "react-icons/lu";
import { Assignee } from "~/components";
import { IssueTaskStatusIcon } from "~/components/Icons";
import { usePermissions, useRouteData, useUser } from "~/hooks";

import type {
  Issue,
  IssueActionTask,
  IssueInvestigationTask,
  IssueReviewer,
} from "~/modules/quality";
import { nonConformanceTaskStatus } from "~/modules/quality";
import { getPrivateUrl, path } from "~/utils/path";

export function TaskProgress({
  tasks,
}: {
  tasks: { status: IssueInvestigationTask["status"] }[];
}) {
  const completedOrSkippedTasks = tasks.filter(
    (task) => task.status === "Completed" || task.status === "Skipped"
  ).length;
  const progressPercentage = (completedOrSkippedTasks / tasks.length) * 100;

  return (
    <div className="flex flex-col items-end gap-2 pt-2 pr-14">
      <Progress value={progressPercentage} className="h-2 w-24" />
      <span className="text-xs text-muted-foreground">
        {completedOrSkippedTasks} of {tasks.length} complete
      </span>
    </div>
  );
}

const statusActions = {
  Completed: {
    action: "Reopen",
    icon: <LuLoaderCircle />,
    status: "Pending",
  },
  Pending: {
    action: "Start",
    icon: <LuCirclePlay />,
    status: "In Progress",
  },
  Skipped: {
    action: "Reopen",
    icon: <LuLoaderCircle />,
    status: "Pending",
  },
  "In Progress": {
    action: "Complete",
    icon: <LuCircleCheck />,
    status: "Completed",
  },
} as const;

export function TaskItem({
  task,
  type,
  isDisabled = false,
}: {
  task: IssueInvestigationTask | IssueActionTask | IssueReviewer;
  type: "investigation" | "action" | "review";
  isDisabled?: boolean;
}) {
  const permissions = usePermissions();
  const disclosure = useDisclosure({
    defaultIsOpen: true,
  });
  const { currentStatus, onOperationStatusChange } = useTaskStatus({
    task,
    type,
    disabled: isDisabled,
  });
  const statusAction = statusActions[currentStatus];
  const { content, setContent, onUpdateContent, onUploadImage } = useTaskNotes({
    initialContent: (task.notes ?? {}) as JSONContent,
    taskId: task.id!,
    type,
  });

  const { id } = useParams();
  const routeData = useRouteData<{ nonConformance: Issue }>(path.to.issue(id!));
  const submit = useSubmit();
  const hasStartedRef = useRef(false);

  const taskTitle =
    type === "investigation"
      ? (task as IssueInvestigationTask).investigationType
      : type === "action"
      ? (task as IssueActionTask).actionType
      : (task as IssueReviewer).title;

  return (
    <div className="rounded-lg border w-full flex flex-col">
      <div className="flex w-full justify-between px-4 py-2 items-center">
        <div className="flex flex-col">
          <span className="text-base font-semibold tracking-tight">
            {taskTitle}
          </span>
        </div>
        <IconButton
          icon={<LuChevronRight />}
          variant="ghost"
          onClick={disclosure.onToggle}
          aria-label="Open task details"
          className={cn(disclosure.isOpen && "rotate-90")}
        />
      </div>

      {disclosure.isOpen && (
        <div className="px-4 py-2 rounded">
          {permissions.can("update", "quality") && !isDisabled ? (
            <Editor
              className="w-full min-h-[100px]"
              initialValue={content}
              onUpload={onUploadImage}
              onChange={(value) => {
                setContent(value);
                onUpdateContent(value);

                // Auto-start issue when typing in task if issue status is "Registered"
                if (
                  routeData?.nonConformance?.status === "Registered" &&
                  !hasStartedRef.current &&
                  value?.content?.some((node: any) => node.content?.length > 0)
                ) {
                  hasStartedRef.current = true;
                  submit(
                    { status: "In Progress" },
                    {
                      method: "post",
                      action: path.to.issueStatus(id!),
                      navigate: false,
                    }
                  );
                }
              }}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(content as JSONContent),
              }}
            />
          )}
        </div>
      )}
      <div className="bg-muted/30 border-t px-4 py-2 flex justify-between w-full">
        <HStack>
          <IssueTaskStatus
            task={task}
            type="investigation"
            isDisabled={isDisabled}
          />
          <Assignee
            table={getTable(type)}
            id={task.id}
            size="sm"
            value={task.assignee ?? undefined}
            disabled={isDisabled}
          />
          {type === "action" && (
            <TaskDueDate
              task={task as IssueActionTask}
              isDisabled={isDisabled}
            />
          )}
        </HStack>
        <HStack>
          <Button
            isDisabled={isDisabled}
            leftIcon={statusAction.icon}
            variant="secondary"
            size="sm"
            onClick={() => {
              onOperationStatusChange(task.id!, statusAction.status);
            }}
          >
            {statusAction.action}
          </Button>
        </HStack>
      </div>
    </div>
  );
}

function useTaskNotes({
  initialContent,
  taskId,
  type,
}: {
  initialContent: JSONContent;
  taskId: string;
  type: "investigation" | "action" | "approval" | "review";
}) {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { carbon } = useCarbon();

  const [content, setContent] = useState(initialContent ?? {});

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const table = getTable(type);

  const onUpdateContent = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from(table)
        .update({
          notes: content,
          updatedBy: userId,
        })
        .eq("id", taskId!);
    },
    2500,
    true
  );

  return {
    content,
    setContent,
    onUpdateContent,
    onUploadImage,
  };
}

function useOptimisticTaskStatus(taskId: string) {
  const fetchers = useFetchers();
  const pendingUpdate = fetchers.find(
    (f) =>
      f.formData?.get("id") === taskId &&
      f.key === `nonConformanceTask:${taskId}`
  );
  return pendingUpdate?.formData?.get("status") as
    | IssueInvestigationTask["status"]
    | undefined;
}

function useTaskStatus({
  disabled = false,
  task,
  type,
  onChange,
}: {
  disabled?: boolean;
  task: {
    id?: string;
    status: IssueInvestigationTask["status"];
    assignee: string | null;
  };
  type: "investigation" | "action" | "approval" | "review";
  onChange?: (status: IssueInvestigationTask["status"]) => void;
}) {
  const submit = useSubmit();
  const permissions = usePermissions();
  const optimisticStatus = useOptimisticTaskStatus(task.id!);

  const isDisabled = !permissions.can("update", "production") || disabled;

  const onOperationStatusChange = useCallback(
    (id: string, status: IssueInvestigationTask["status"]) => {
      onChange?.(status);
      submit(
        {
          id,
          status,
          type,
          assignee: task.assignee ?? "",
        },
        {
          method: "post",
          action: path.to.issueTaskStatus(id),
          navigate: false,
          fetcherKey: `nonConformanceTask:${id}`,
        }
      );
    },
    [onChange, submit, task.assignee, type]
  );

  const currentStatus = optimisticStatus || task.status;

  return {
    currentStatus,
    onOperationStatusChange,
    isDisabled,
  };
}

export function IssueTaskStatus({
  task,
  type,
  className,
  onChange,
  isDisabled,
}: {
  task: {
    id?: string;
    status: IssueInvestigationTask["status"];
    assignee: string | null;
  };
  type: "investigation" | "action" | "approval" | "review";
  className?: string;
  onChange?: (status: IssueInvestigationTask["status"]) => void;
  isDisabled?: boolean;
}) {
  const { currentStatus, onOperationStatusChange } = useTaskStatus({
    task,
    type,
    onChange,
    disabled: isDisabled,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="sm"
          variant="ghost"
          className={className}
          aria-label="Change status"
          icon={<IssueTaskStatusIcon status={currentStatus} />}
          isDisabled={isDisabled}
        />
      </DropdownMenuTrigger>
      {!isDisabled && (
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={currentStatus}
            onValueChange={(status) =>
              onOperationStatusChange(
                task.id!,
                status as IssueInvestigationTask["status"]
              )
            }
          >
            {nonConformanceTaskStatus.map((status) => (
              <DropdownMenuRadioItem key={status} value={status}>
                <DropdownMenuIcon
                  icon={<IssueTaskStatusIcon status={status} />}
                />
                <span>{status}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

function getTable(type: "investigation" | "action" | "approval" | "review") {
  switch (type) {
    case "investigation":
      return "nonConformanceInvestigationTask";
    case "action":
      return "nonConformanceActionTask";
    case "approval":
      return "nonConformanceApprovalTask";
    case "review":
      return "nonConformanceReviewer";
  }
}

function TaskDueDate({
  task,
  isDisabled,
}: {
  task: IssueActionTask;
  isDisabled: boolean;
}) {
  const submit = useSubmit();
  const [isOpen, setIsOpen] = useState(false);
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "quality") && !isDisabled;

  const handleDateChange = (date: string | null) => {
    submit(
      {
        id: task.id!,
        dueDate: date || "",
      },
      {
        method: "post",
        action: path.to.issueActionDueDate(task.id!),
        navigate: false,
      }
    );
    setIsOpen(false);
  };

  if (!canEdit) {
    return (
      <HStack className="text-sm text-muted-foreground">
        <LuCalendar className="w-4 h-4" />
        <span>{task.dueDate ? formatDate(task.dueDate) : "No due date"}</span>
      </HStack>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <LuCalendar className="w-4 h-4 mr-1" />
          <span>
            {task.dueDate ? formatDate(task.dueDate) : "Set due date"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-2">
          <input
            type="date"
            value={task.dueDate || ""}
            onChange={(e) => handleDateChange(e.target.value || null)}
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
          {task.dueDate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDateChange(null)}
              className="w-full"
            >
              Clear due date
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
