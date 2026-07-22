import { useCarbon } from "@carbon/auth";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  BarProgress,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  cn,
  DatePicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
  useDebounce
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCalendar, LuCog, LuContainer } from "react-icons/lu";
import { RxCheck } from "react-icons/rx";
import { useFetchers, useParams, useSubmit } from "react-router";
import {
  ActionTaskCard,
  type ActionTaskStatus
} from "~/components/ActionTasks/ActionTaskCard";
import { ActionTaskStatusButton } from "~/components/ActionTasks/ActionTaskStatusButton";
import { useProcesses } from "~/components/Form/Process";
import SupplierAvatar from "~/components/SupplierAvatar";
import {
  useDateFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { useRealtime } from "~/hooks/useRealtime";
import type {
  Issue,
  IssueActionTask,
  IssueItem,
  IssueReviewer
} from "~/modules/quality";
import { useSuppliers } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import { JiraIssueDialog } from "./Jira/IssueDialog";
import { LinearIssueDialog } from "./Linear/IssueDialog";

const logger = getLogger("erp", "issuetask");

// TaskProgress moved to the shared ActionTasks folder (SSOT with Change Orders);
// re-exported here so existing `~/modules/quality/ui/Issue` importers keep working.
export { ActionTaskProgress as TaskProgress } from "~/components/ActionTasks/ActionTaskProgress";

export function ItemProgress({ items }: { items: IssueItem[] }) {
  const completedOrSkippedItems = items.filter(
    (item) => item.disposition
  ).length;
  const progressPercentage = (completedOrSkippedItems / items.length) * 100;

  return (
    <div className="flex flex-col items-end gap-2 pt-2 pr-14">
      <BarProgress
        gradient
        progress={progressPercentage}
        value={`${completedOrSkippedItems}/${items.length}`}
      />
    </div>
  );
}

function SupplierAssignment({
  task,
  type,
  supplierIds,
  isDisabled = false
}: {
  task: IssueActionTask;
  type: "investigation" | "action";
  supplierIds: string[];
  isDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [suppliers] = useSuppliers();
  const submit = useSubmit();
  const { t } = useLingui();
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

    return [{ value: "", label: t`Unassigned` }, ...filteredSuppliers];
  }, [suppliers, supplierIds, t]);

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
            <span>
              <Trans>Supplier</Trans>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {canEdit && (
        <PopoverContent
          align="start"
          className="min-w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput
              placeholder={t`Search suppliers...`}
              className="h-9"
            />
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
  task: IssueActionTask | IssueReviewer;
  type: "investigation" | "action" | "review";
  suppliers: { supplierId: string; externalLinkId: string | null }[];
  isDisabled?: boolean;
  showDragHandle?: boolean;
  dragControls?: DragControls;
}) {
  useRealtime("nonConformanceActionTask", `id=eq.${task.id}`);

  const integrations = useIntegrations();
  const permissions = usePermissions();

  const {
    currentStatus,
    onOperationStatusChange,
    isDisabled: statusDisabled
  } = useTaskStatus({
    task,
    type,
    disabled: isDisabled
  });

  // Check if this action task has a linked Linear or Jira issue
  const hasLinearLink =
    type === "action" && !!(task as IssueActionTask).linearIssue;
  const hasJiraLink =
    type === "action" && !!(task as IssueActionTask).jiraIssue;

  const { content, setContent, onUpdateContent, onUploadImage } = useTaskNotes({
    initialContent: (task.notes ?? {}) as JSONContent,
    taskId: task.id!,
    type,
    hasLinearLink,
    hasJiraLink
  });

  const { id } = useParams();
  const routeData = useRouteData<{ nonConformance: Issue }>(path.to.issue(id!));
  const submit = useSubmit();
  const hasStartedRef = useRef(false);

  let taskTitle =
    type === "action"
      ? (task as IssueActionTask).name
      : (task as IssueReviewer).title;

  if (type === "action" && (task as IssueActionTask).supplierId) {
    taskTitle = `Supplier ${taskTitle}`;
  }

  return (
    <ActionTaskCard
      title={taskTitle ?? ""}
      status={currentStatus as ActionTaskStatus}
      notes={content as JSONContent}
      canEditNotes={permissions.can("update", "quality") && !isDisabled}
      onNotesChange={(value) => {
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
      onUploadImage={onUploadImage}
      onStatusChange={(next) => onOperationStatusChange(task.id!, next)}
      assigneeTable={getTable(type)}
      assigneeId={task.id!}
      assignee={task.assignee ?? undefined}
      isDisabled={statusDisabled}
      showDragHandle={showDragHandle}
      dragControls={dragControls}
      statusBadge={
        <IssueTaskStatus
          task={task}
          type="investigation"
          isDisabled={isDisabled}
        />
      }
      headerExtras={
        <>
          {/* @ts-expect-error TS2322 */}
          {integrations.has("linear") && <LinearIssueDialog task={task} />}
          {/* @ts-expect-error TS2322 */}
          {integrations.has("jira") && <JiraIssueDialog task={task} />}
        </>
      }
      footerExtras={
        <>
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
              task={task as IssueActionTask}
              type={type}
              supplierIds={suppliers.map((s) => s.supplierId)}
              isDisabled={isDisabled}
            />
          )}
        </>
      }
    />
  );
}

function useTaskNotes({
  initialContent,
  taskId,
  type,
  hasLinearLink = false,
  hasJiraLink = false
}: {
  initialContent: JSONContent;
  taskId: string;
  type: "investigation" | "action" | "approval" | "review";
  hasLinearLink?: boolean;
  hasJiraLink?: boolean;
}) {
  const { t } = useLingui();
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
      toast.error(t`Failed to upload image`);
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
          logger.error("Failed to sync notes to Linear", { error: e });
        }
      }

      // Sync to Jira if this is an action task with a linked Jira issue
      if (type === "action" && hasJiraLink) {
        try {
          await fetch(path.to.api.jiraSyncNotes, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              actionId: taskId,
              notes: JSON.stringify(content)
            })
          });
        } catch (e) {
          // Silently fail Jira sync - not critical
          logger.error("Failed to sync notes to Jira", { error: e });
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
    | IssueActionTask["status"]
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
    status: IssueActionTask["status"];
    assignee: string | null;
  };
  type: "investigation" | "action" | "approval" | "review";
  onChange?: (status: IssueActionTask["status"]) => void;
}) {
  const submit = useSubmit();
  const permissions = usePermissions();
  const optimisticStatus = useOptimisticTaskStatus(task.id!);

  const isDisabled = !permissions.can("update", "production") || disabled;

  const onOperationStatusChange = useCallback(
    (id: string, status: IssueActionTask["status"]) => {
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
    status: IssueActionTask["status"];
    assignee: string | null;
  };
  type: "investigation" | "action" | "approval" | "review";
  className?: string;
  onChange?: (status: IssueActionTask["status"]) => void;
  isDisabled?: boolean;
}) {
  const {
    currentStatus,
    onOperationStatusChange,
    isDisabled: statusDisabled
  } = useTaskStatus({
    task,
    type,
    onChange,
    disabled: isDisabled
  });

  return (
    <ActionTaskStatusButton
      status={currentStatus as ActionTaskStatus}
      onChange={(next) => onOperationStatusChange(task.id!, next)}
      isDisabled={statusDisabled}
      className={className}
    />
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
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
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
          isDisabled={isDisabled}
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
            >
              <Trans>Clear due date</Trans>
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
  const { t } = useLingui();
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
      ? t`Processes`
      : selectedProcesses.length === 1
        ? selectedProcesses[0].label
        : t`${selectedProcesses.length} Processes`;

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
          <CommandInput placeholder={t`Search processes...`} className="h-9" />
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
