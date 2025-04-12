import { useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  toast,
  useDebounce,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetchers, useLoaderData, useSubmit } from "@remix-run/react";
import { nanoid } from "nanoid";
import { useCallback, useState } from "react";
import {
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuCircleX,
  LuLoaderCircle,
} from "react-icons/lu";
import { Assignee } from "~/components";
import { NonConformanceTaskStatusIcon } from "~/components/Icons";
import { usePermissions, useUser } from "~/hooks";

import type { NonConformanceInvestigationTask } from "~/modules/quality";
import {
  getNonConformanceTasks,
  nonConformanceTaskStatus,
} from "~/modules/quality";
import { getPrivateUrl, path } from "~/utils/path";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Non-conformance ID is required");

  const [investigationTasks, actionTasks, approvalTasks] =
    await getNonConformanceTasks(client, id, companyId);

  return json({
    investigationTasks: investigationTasks.data || [],
    actionTasks: actionTasks.data || [],
    approvalTasks: approvalTasks.data || [],
  });
}

export default function NonConformanceTasks() {
  const { investigationTasks, actionTasks, approvalTasks } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={4} className="w-full">
      <InvestigationTasksList tasks={investigationTasks} />
      <ActionTasksList tasks={actionTasks} />
      <ApprovalTasksList tasks={approvalTasks} />
    </VStack>
  );
}

function InvestigationTasksList({ tasks }: { tasks: any[] }) {
  if (tasks.length === 0) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Investigation Tasks
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={3}>
          {tasks.map((task) => (
            <InvestigationTaskItem key={task.id} task={task} />
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
}

function ActionTasksList({ tasks }: { tasks: any[] }) {
  if (tasks.length === 0) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Action Tasks</CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={3}>
          {tasks.map((task) => (
            <ActionTaskItem key={task.id} task={task} />
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
}

function ApprovalTasksList({ tasks }: { tasks: any[] }) {
  if (tasks.length === 0) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Approval Tasks
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={3}>
          {tasks.map((task) => (
            <ApprovalTaskItem key={task.id} task={task} />
          ))}
        </VStack>
      </CardContent>
    </Card>
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

function InvestigationTaskItem({
  task,
}: {
  task: NonConformanceInvestigationTask;
}) {
  const permissions = usePermissions();
  const disclosure = useDisclosure();
  const { currentStatus, onOperationStatusChange, isDisabled } = useTaskStatus({
    task,
    type: "investigation",
  });
  const statusAction = statusActions[currentStatus];
  const { content, setContent, onUpdateContent, onUploadImage } = useTaskNotes({
    initialContent: (task.notes ?? {}) as JSONContent,
    taskId: task.id!,
    type: "investigation",
  });

  return (
    <div className="rounded-lg border w-full flex flex-col">
      <div className="flex w-full justify-between px-4 py-2 items-center">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{task.investigationType}</span>
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
          {permissions.can("update", "quality") ? (
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
              dangerouslySetInnerHTML={{
                __html: generateHTML(content as JSONContent),
              }}
            />
          )}
        </div>
      )}
      <div className="bg-muted/30 border-t px-4 py-2 flex justify-between w-full">
        <HStack>
          <NonConformanceTaskStatus task={task} type="investigation" />
          <Assignee
            table="nonConformanceInvestigationTask"
            id={task.id}
            size="sm"
            value={task.assignee ?? undefined}
          />
        </HStack>
        <HStack>
          {currentStatus === "Pending" && (
            <Button
              isDisabled={isDisabled}
              variant="secondary"
              size="sm"
              leftIcon={<LuCircleX />}
              onClick={() => {
                onOperationStatusChange(task.id!, "Skipped");
              }}
            >
              Skip
            </Button>
          )}
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

function ActionTaskItem({ task }: { task: any }) {
  return <pre>{JSON.stringify(task, null, 2)}</pre>;
}

function ApprovalTaskItem({ task }: { task: any }) {
  return <pre>{JSON.stringify(task, null, 2)}</pre>;
}

function useTaskNotes({
  initialContent,
  taskId,
  type,
}: {
  initialContent: JSONContent;
  taskId: string;
  type: "investigation" | "action" | "approval";
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

  const table =
    type === "investigation"
      ? "nonConformanceInvestigationTask"
      : type === "action"
      ? "nonConformanceActionTask"
      : "nonConformanceApprovalTask";

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
    | NonConformanceInvestigationTask["status"]
    | undefined;
}

function useTaskStatus({
  task,
  type,
  onChange,
}: {
  task: {
    id?: string;
    status: NonConformanceInvestigationTask["status"];
    assignee: string | null;
  };
  type: "investigation" | "action" | "approval";
  onChange?: (status: NonConformanceInvestigationTask["status"]) => void;
}) {
  const submit = useSubmit();
  const permissions = usePermissions();
  const optimisticStatus = useOptimisticTaskStatus(task.id!);

  const isDisabled = !permissions.can("update", "production");

  const onOperationStatusChange = useCallback(
    (id: string, status: NonConformanceInvestigationTask["status"]) => {
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
          action: path.to.nonConformanceTaskStatus(id),
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

export function NonConformanceTaskStatus({
  task,
  type,
  className,
  onChange,
}: {
  task: {
    id?: string;
    status: NonConformanceInvestigationTask["status"];
    assignee: string | null;
  };
  type: "investigation" | "action" | "approval";
  className?: string;
  onChange?: (status: NonConformanceInvestigationTask["status"]) => void;
}) {
  const { currentStatus, onOperationStatusChange, isDisabled } = useTaskStatus({
    task,
    type,
    onChange,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="sm"
          variant="ghost"
          className={className}
          aria-label="Change status"
          icon={<NonConformanceTaskStatusIcon status={currentStatus} />}
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
                status as NonConformanceInvestigationTask["status"]
              )
            }
          >
            {nonConformanceTaskStatus.map((status) => (
              <DropdownMenuRadioItem key={status} value={status}>
                <DropdownMenuIcon
                  icon={<NonConformanceTaskStatusIcon status={status} />}
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
