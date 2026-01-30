import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  cn,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  generateHTML,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  toast,
  useDebounce,
  useDisclosure
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { DragControls } from "framer-motion";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCalendar,
  LuChevronRight,
  LuCircleCheck,
  LuCirclePlay,
  LuCog,
  LuContainer,
  LuGripVertical,
  LuLoaderCircle
} from "react-icons/lu";
import { RxCheck } from "react-icons/rx";
import { useFetchers, useParams, useSubmit } from "react-router";
import { Assignee } from "~/components";
import { useProcesses } from "~/components/Form/Process";
import { IssueTaskStatusIcon } from "~/components/Icons";
import SupplierAvatar from "~/components/SupplierAvatar";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { useRealtime } from "~/hooks/useRealtime";
import type {
  Issue,
  IssueActionTask,
  IssueInvestigationTask,
  IssueItem,
  IssueReviewer
} from "~/modules/quality";
import { nonConformanceTaskStatus } from "~/modules/quality";
import { useSuppliers } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import { LinearIssueDialog } from "./Linear/IssueDialog";

export function TaskProgress({
  tasks,
  className
}: {
  tasks: { status: IssueInvestigationTask["status"] }[];
  className?: string;
}) {
  const completedOrSkippedTasks = tasks.filter(
    (task) => task.status === "Completed" || task.status === "Skipped"
  ).length;
  const progressPercentage = (completedOrSkippedTasks / tasks.length) * 100;

  return (
    <div className={cn("flex flex-col items-end gap-2 pt-2 pr-14", className)}>
      <Progress value={progressPercentage} className="h-2 w-24" />
      <span className="text-xs text-muted-foreground">
        {completedOrSkippedTasks} of {tasks.length} complete
      </span>
    </div>
  );
}

export function ItemProgress({ items }: { items: IssueItem[] }) {
  const completedOrSkippedItems = items.filter(
    (item) => item.disposition
  ).length;
  const progressPercentage = (completedOrSkippedItems / items.length) * 100;

  return (
    <div className="flex flex-col items-end gap-2 pt-2 pr-14">
      <Progress value={progressPercentage} className="h-2 w-24" />
      <span className="text-xs text-muted-foreground">
        {completedOrSkippedItems} of {items.length} complete
      </span>
    </div>
  );
}

export const statusActions = {
  Completed: {
    action: "Reopen",
    icon: <LuLoaderCircle />,
    status: "Pending"
  },
  Pending: {
    action: "Start",
    icon: <LuCirclePlay />,
    status: "In Progress"
  },
  Skipped: {
    action: "Reopen",
    icon: <LuLoaderCircle />,
    status: "Pending"
  },
  "In Progress": {
    action: "Complete",
    icon: <LuCircleCheck />,
    status: "Completed"
  }
} as const;

function SupplierAssignment({
  task,
  type,
  supplierIds,
  isDisabled = false
}: {
  task: IssueInvestigationTask | IssueActionTask;
  type: "investigation" | "action";
  supplierIds: string[];
  isDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [suppliers] = useSuppliers();
  const submit = useSubmit();
  const permissions = usePermissions();
  const fetchers = useFetchers();

  const canEdit = permissions.can("update", "quality") && !isDisabled;

  // Check for optimistic update
  const pendingUpdate = fetchers.find(
    (f) =>
      f.formData?.get("id") === task.id &&
      f.key === `supplierAssignment:${task.id}`
  );

  const currentSupplierId =
    (pendingUpdate?.formData?.get("supplierId") as string | null) ??
    task.supplierId;

  const handleChange = (supplierId: string) => {
    const table =
      type === "investigation"
        ? "nonConformanceInvestigationTask"
        : "nonConformanceActionTask";

    submit(
      {
        id: task.id!,
        supplierId: supplierId || "",
        table
      },
      {
        method: "post",
        action: path.to.issueTaskSupplier,
        navigate: false,
        fetcherKey: `supplierAssignment:${task.id}`
      }
    );
    setOpen(false);
  };

  // Filter suppliers to only those passed in supplierIds
  const options = useMemo(() => {
    const filteredSuppliers = suppliers
      .filter((supplier) => supplierIds.includes(supplier.id))
      .map((supplier) => ({
        value: supplier.id,
        label: supplier.name
      }));

    return [{ value: "", label: "Unassigned" }, ...filteredSuppliers];
  }, [suppliers, supplierIds]);

  const isPending = pendingUpdate && pendingUpdate?.state !== "idle";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuContainer />}
          isDisabled={isDisabled || !canEdit}
          isLoading={isPending}
        >
          {currentSupplierId ? (
            <SupplierAvatar
              supplierId={currentSupplierId}
              size="xxs"
              className="text-sm"
            />
          ) : (
            <span>Supplier</span>
          )}
        </Button>
      </PopoverTrigger>
      {canEdit && (
        <PopoverContent
          align="start"
          className="min-w-[--radix-popover-trigger-width] p-0"
        >
          <Command>
            <CommandInput placeholder="Search suppliers..." className="h-9" />
            <CommandEmpty>No supplier found.</CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-y-auto">
              {options.map((option) => (
                <CommandItem
                  value={option.label}
                  key={option.value}
                  onSelect={() => handleChange(option.value)}
                >
                  {option.label}
                  <RxCheck
                    className={cn(
                      "ml-auto h-4 w-4",
                      option.value === currentSupplierId
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      )}
    </Popover>
  );
}

export function TaskItem({
  task,
  type,
  suppliers,
  isDisabled = false,
  showDragHandle = false,
  dragControls
}: {
  task: IssueInvestigationTask | IssueActionTask | IssueReviewer;
  type: "investigation" | "action" | "review";
  suppliers: { supplierId: string; externalLinkId: string | null }[];
  isDisabled?: boolean;
  showDragHandle?: boolean;
  dragControls?: DragControls;
}) {
  useRealtime("nonConformanceActionTask", `id=eq.${task.id}`);

  const integrations = useIntegrations();
  const permissions = usePermissions();
  const disclosure = useDisclosure({
    defaultIsOpen: true
  });

  const { currentStatus, onOperationStatusChange } = useTaskStatus({
    task,
    type,
    disabled: isDisabled
  });
  const statusAction =
    statusActions[currentStatus as keyof typeof statusActions];

  // Check if this action task has a linked Linear issue
  const hasLinearLink =
    type === "action" && !!(task as IssueActionTask).linearIssue;

  const { content, setContent, onUpdateContent, onUploadImage } = useTaskNotes({
    initialContent: (task.notes ?? {}) as JSONContent,
    taskId: task.id!,
    type,
    hasLinearLink
  });

  const { id } = useParams();
  const routeData = useRouteData<{ nonConformance: Issue }>(path.to.issue(id!));
  const submit = useSubmit();
  const hasStartedRef = useRef(false);

  let taskTitle =
    type === "action"
      ? (task as IssueActionTask).name
      : (task as IssueReviewer).title;

  if (task.supplierId) {
    taskTitle = `Supplier ${taskTitle}`;
  }

  return (
    <div className="rounded-lg border w-full flex flex-col bg-card">
      <div className="flex w-full justify-between px-4 py-2 items-center">
        <div className="flex flex-col flex-1">
          <span className="text-base font-semibold tracking-tight">
            {taskTitle}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {showDragHandle && !isDisabled && dragControls && (
            <button
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors p-1"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <LuGripVertical size={16} />
            </button>
          )}

          {integrations.has("linear") && <LinearIssueDialog task={task} />}

          <IconButton
            icon={<LuChevronRight />}
            variant="ghost"
            onClick={disclosure.onToggle}
            aria-label="Open task details"
            className={cn(disclosure.isOpen && "rotate-90")}
          />
        </div>
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
                      navigate: false
                    }
                  );
                }
              }}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(content as JSONContent)
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
            <>
              <TaskDueDate
                task={task as IssueActionTask}
                isDisabled={isDisabled}
              />
              <TaskProcesses
                task={task as IssueActionTask}
                isDisabled={isDisabled}
              />
            </>
          )}
          {(type === "investigation" || type === "action") && (
            <SupplierAssignment
              task={task as IssueInvestigationTask | IssueActionTask}
              type={type}
              supplierIds={suppliers.map((s) => s.supplierId)}
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
  hasLinearLink = false
}: {
  initialContent: JSONContent;
  taskId: string;
  type: "investigation" | "action" | "approval" | "review";
  hasLinearLink?: boolean;
}) {
  const {
    id: userId,
    company: { id: companyId }
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
      // Update notes in Carbon database
      await carbon
        // @ts-expect-error -
        ?.from(table)
        .update({
          notes: content,
          updatedBy: userId
        })
        .eq("id", taskId!);

      // Sync to Linear if this is an action task with a linked Linear issue
      if (type === "action" && hasLinearLink) {
        try {
          await fetch(path.to.api.linearSyncNotes, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              actionId: taskId,
              notes: JSON.stringify(content)
            })
          });
        } catch (e) {
          // Silently fail Linear sync - not critical
          console.error("Failed to sync notes to Linear:", e);
        }
      }
    },
    2500,
    true
  );

  return {
    content,
    setContent,
    onUpdateContent,
    onUploadImage
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
  onChange
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
          assignee: task.assignee ?? ""
        },
        {
          method: "post",
          action: path.to.issueTaskStatus(id),
          navigate: false,
          fetcherKey: `nonConformanceTask:${id}`
        }
      );
    },
    [onChange, submit, task.assignee, type]
  );

  const currentStatus = optimisticStatus || task.status;

  return {
    currentStatus,
    onOperationStatusChange,
    isDisabled
  };
}

export function IssueTaskStatus({
  task,
  type,
  className,
  onChange,
  isDisabled
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
    disabled: isDisabled
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
  isDisabled
}: {
  task: IssueActionTask;
  isDisabled: boolean;
}) {
  const submit = useSubmit();
  const [isOpen, setIsOpen] = useState(false);
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "quality") && !isDisabled;
  const fetchers = useFetchers();
  const pendingUpdate = fetchers.find(
    (f) =>
      f.formData?.get("id") === task.id &&
      f.key === `nonConformanceTask:${task.id}`
  );

  const pendingValue = pendingUpdate?.formData?.get("dueDate") ?? task.dueDate;

  const handleDateChange = (date: string | null) => {
    submit(
      {
        id: task.id!,
        dueDate: date || ""
      },
      {
        method: "post",
        action: path.to.issueActionDueDate(task.id!),
        navigate: false,
        fetcherKey: `nonConformanceTask:${task.id}`
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
        <span>{task.dueDate ? formatDate(task.dueDate) : "No due date"}</span>
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
          isDisabled={isDisabled}
        >
          {pendingValue ? formatDate(String(pendingValue)) : "Due Date"}
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
            >
              Clear due date
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TaskProcesses({
  task,
  isDisabled
}: {
  task: IssueActionTask;
  isDisabled: boolean;
}) {
  const submit = useSubmit();
  const [isOpen, setIsOpen] = useState(false);
  const permissions = usePermissions();
  const processOptions = useProcesses();

  // Get current process IDs from the task (memoized to prevent unnecessary re-renders)
  const currentProcessIds = useMemo(
    () => task.nonConformanceActionProcess?.map((p) => p.processId) ?? [],
    [task.nonConformanceActionProcess]
  );

  // Local state for immediate UI updates
  const [localProcessIds, setLocalProcessIds] =
    useState<string[]>(currentProcessIds);

  // Sync local state when task data changes (after revalidation)
  useEffect(() => {
    setLocalProcessIds(currentProcessIds);
  }, [currentProcessIds]);

  const canEdit = permissions.can("update", "quality") && !isDisabled;
  const fetchers = useFetchers();
  const pendingUpdate = fetchers.find(
    (f) =>
      (f.json as { id?: string })?.id === task.id &&
      f.key === `nonConformanceTaskProcesses:${task.id}`
  );

  const pendingProcessIds = (pendingUpdate?.json as { processIds?: string[] })
    ?.processIds;

  const activeProcessIds = pendingProcessIds ?? localProcessIds;

  const handleProcessToggle = (processId: string) => {
    const newProcessIds = activeProcessIds.includes(processId)
      ? activeProcessIds.filter((id) => id !== processId)
      : [...activeProcessIds, processId];

    // Update local state immediately for instant UI feedback
    setLocalProcessIds(newProcessIds);

    submit(
      {
        id: task.id!,
        processIds: newProcessIds
      },
      {
        method: "post",
        action: path.to.issueActionProcesses(task.id!),
        navigate: false,
        fetcherKey: `nonConformanceTaskProcesses:${task.id}`,
        encType: "application/json"
      }
    );
  };

  const selectedProcesses = processOptions.filter((p) =>
    activeProcessIds.includes(p.value)
  );

  const buttonLabel =
    selectedProcesses.length === 0
      ? "Processes"
      : selectedProcesses.length === 1
        ? selectedProcesses[0].label
        : `${selectedProcesses.length} Processes`;

  if (!canEdit) {
    return (
      <Button variant="secondary" size="sm" leftIcon={<LuCog />} isDisabled>
        <span>{buttonLabel}</span>
      </Button>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger disabled={isDisabled} asChild>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuCog />}
          isDisabled={isDisabled}
        >
          {buttonLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search processes..." className="h-9" />
          <CommandEmpty>No process found.</CommandEmpty>
          <CommandGroup className="max-h-[300px] overflow-y-auto">
            {processOptions.map((option) => (
              <CommandItem
                key={option.value}
                value={option.label}
                onSelect={() => handleProcessToggle(option.value)}
              >
                <div
                  className={cn(
                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                    activeProcessIds.includes(option.value)
                      ? "bg-primary text-primary-foreground"
                      : "opacity-50 [&_svg]:invisible"
                  )}
                >
                  <RxCheck className="h-4 w-4" />
                </div>
                <span>{option.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
