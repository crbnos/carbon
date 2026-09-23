import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Label,
  toast,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { LuLink, LuLink2Off, LuShieldCheck } from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar } from "~/components";
import {
  DatePicker,
  Employee,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import {
  type ChangeNoticeImpactTaskLink,
  type ChangeNoticeImpactWorkspaceCandidate,
  changeNoticeImpactTaskCreateFormValidator,
  changeNoticeImpactTaskRelationshipFormValidator,
  changeNoticeOpenStatuses,
  changeNoticeStageFlow
} from "../../items.models";
import type { ChangeNoticeActionTask, ChangeNoticeStatus } from "../../types";
import { ChangeNoticeActionTaskItem } from "./ChangeNoticeActionTaskItem";

const EMPTY_NOTES: JSONContent = {};

type ImpactTaskMutationResponse = {
  success?: boolean;
  data?: unknown;
  error?: { message?: string };
};

type ImpactTaskProps = {
  changeNoticeId: string;
  changeNoticeStatus: ChangeNoticeStatus | null | undefined;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  actions: ChangeNoticeActionTask[];
  canUpdate: boolean;
  taskCoverageStatus: "complete" | "partial" | "failed";
  onRefresh: () => void;
};

function taskStatusLabel(status: ChangeNoticeImpactTaskLink["status"]) {
  switch (status) {
    case "Pending":
      return <Trans>Pending</Trans>;
    case "In Progress":
      return <Trans>In Progress</Trans>;
    case "Completed":
      return <Trans>Completed</Trans>;
    case "Skipped":
      return <Trans>Skipped</Trans>;
  }
}

function taskOriginLabel(origin: string) {
  switch (origin) {
    case "Template-owned":
      return <Trans>Template-owned</Trans>;
    case "Manual":
      return <Trans>Manual</Trans>;
    case "Impact follow-up":
      return <Trans>Impact follow-up</Trans>;
    default:
      return origin;
  }
}

function taskDateLabel(value: string | null, locale: string) {
  return value ? formatDate(value, undefined, locale) : null;
}

function isImpactTaskOrigin(origin: string) {
  return origin === "Impact follow-up";
}

function canUseImpactTaskRelationships(
  status: ChangeNoticeStatus | null | undefined
) {
  return (
    status === "Done" ||
    status === "Cancelled" ||
    (status !== null &&
      status !== undefined &&
      (changeNoticeStageFlow as readonly string[]).includes(status))
  );
}

function canCreateImpactTask(
  candidate: ChangeNoticeImpactWorkspaceCandidate,
  status: ChangeNoticeStatus | null | undefined
) {
  return (
    candidate.sourceAvailability !== "Restricted" &&
    candidate.decision?.status === "Action required" &&
    canUseImpactTaskRelationships(status)
  );
}

function RelationshipButton({
  operation,
  changeNoticeId,
  candidate,
  task,
  disabled,
  onSuccess
}: {
  operation: "unlink" | "designate";
  changeNoticeId: string;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  task: ChangeNoticeImpactTaskLink;
  disabled: boolean;
  onSuccess: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<ImpactTaskMutationResponse>();

  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data?.success !== true) return;
    onSuccess();
  }, [fetcher.data, fetcher.state, onSuccess]);

  const submit = () => {
    if (disabled || !candidate.decision) return;
    const formData = new FormData();
    formData.append("decisionId", candidate.decision.id);
    formData.append("targetType", candidate.targetType);
    formData.append("targetId", candidate.targetId);
    formData.append("actionTaskId", task.actionTaskId);
    fetcher.submit(formData, {
      method: "post",
      action:
        operation === "unlink"
          ? path.to.changeNoticeImpactTaskUnlink(changeNoticeId)
          : path.to.changeNoticeImpactTaskDesignate(changeNoticeId)
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      leftIcon={operation === "unlink" ? <LuLink2Off /> : <LuShieldCheck />}
      onClick={submit}
      isDisabled={disabled || fetcher.state !== "idle"}
      isLoading={fetcher.state !== "idle"}
      aria-label={
        operation === "unlink"
          ? t`Unlink task`
          : t`Designate as Impact follow-up`
      }
    >
      {operation === "unlink" ? (
        <Trans>Unlink</Trans>
      ) : (
        <Trans>Designate</Trans>
      )}
    </Button>
  );
}

function ImpactTaskCreateDrawer({
  changeNoticeId,
  candidate,
  open,
  onClose,
  onSuccess
}: {
  changeNoticeId: string;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const {
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();
  const fetcher = useFetcher<ImpactTaskMutationResponse>();
  const [notes, setNotes] = useState<JSONContent>(EMPTY_NOTES);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success === true) {
      onSuccess();
    }
  }, [fetcher.data, fetcher.state, onSuccess]);

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

  const failedResponse =
    fetcher.data && fetcher.data.success === false ? fetcher.data : null;

  return (
    <Drawer open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DrawerContent size="sm">
        <ValidatedForm
          key={`${candidate.targetType}-${candidate.targetId}-${candidate.decision?.id ?? "bootstrap"}`}
          validator={changeNoticeImpactTaskCreateFormValidator}
          method="post"
          action={path.to.changeNoticeImpactTaskCreate(changeNoticeId)}
          fetcher={fetcher}
          className="flex h-full flex-col"
        >
          <DrawerHeader>
            <DrawerTitle>
              <Trans>Create Impact follow-up</Trans>
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Hidden name="targetType" value={candidate.targetType} />
              <Hidden name="targetId" value={candidate.targetId} />
              <Hidden name="decisionId" value={candidate.decision?.id ?? ""} />
              <div className="w-full rounded-md bg-muted/40 p-3 text-xs">
                <div className="font-medium">
                  <Trans>Follow-up for</Trans> {candidate.targetId}
                </div>
                <div className="text-muted-foreground">
                  <Trans>Task origin: Impact follow-up</Trans>
                </div>
              </div>
              <Input name="name" label={t`Task name`} />
              <Employee name="assignee" type="assignee" label={t`Assignee`} />
              <DatePicker name="dueDate" label={t`Due date`} />
              <div className="flex w-full flex-col gap-2">
                <Label>
                  <Trans>Notes</Trans>
                </Label>
                <Hidden name="notes" value={JSON.stringify(notes)} />
                <Editor
                  initialValue={notes}
                  onUpload={onUploadImage}
                  onChange={setNotes}
                  className="min-h-[120px] w-full rounded-md border px-4 py-3 [&_.is-empty]:text-muted-foreground"
                />
              </div>
              {failedResponse && (
                <div
                  role="alert"
                  className="w-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  <Trans>Impact task could not be created.</Trans>
                </div>
              )}
              {!permissions.can("update", "parts") && (
                <div
                  role="alert"
                  className="w-full rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                >
                  <Trans>You do not have permission to update this task.</Trans>
                </div>
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit
                isDisabled={isSubmitting || !permissions.can("update", "parts")}
              >
                <Trans>Create task</Trans>
              </Submit>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                isDisabled={isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}

function ImpactTaskLinkDrawer({
  changeNoticeId,
  candidate,
  tasks,
  open,
  onClose,
  onSuccess
}: {
  changeNoticeId: string;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  tasks: ChangeNoticeActionTask[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<ImpactTaskMutationResponse>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success === true) onSuccess();
  }, [fetcher.data, fetcher.state, onSuccess]);

  const options = tasks.map((task) => ({
    value: task.id,
    label: (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate">
          {task.name ?? <Trans>Unnamed task</Trans>}
        </span>
        <Badge variant="outline" className="shrink-0 whitespace-nowrap">
          {taskStatusLabel(task.status)}
        </Badge>
        <Badge variant="outline" className="shrink-0 whitespace-nowrap">
          {taskOriginLabel(task.taskOrigin ?? "Manual")}
        </Badge>
      </div>
    )
  }));
  const defaultTaskId = tasks[0]?.id;

  return (
    <Drawer open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DrawerContent size="sm">
        <ValidatedForm
          key={`${candidate.targetType}-${candidate.targetId}-${defaultTaskId ?? "empty"}`}
          validator={changeNoticeImpactTaskRelationshipFormValidator}
          method="post"
          action={path.to.changeNoticeImpactTaskLink(changeNoticeId)}
          fetcher={fetcher}
          className="flex h-full flex-col"
          defaultValues={{ actionTaskId: defaultTaskId }}
        >
          <DrawerHeader>
            <DrawerTitle>
              <Trans>Link existing task</Trans>
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Hidden name="decisionId" value={candidate.decision?.id ?? ""} />
              <Hidden name="targetType" value={candidate.targetType} />
              <Hidden name="targetId" value={candidate.targetId} />
              {tasks.length > 0 ? (
                <Select
                  name="actionTaskId"
                  label={t`Task`}
                  options={options}
                  isRequired
                />
              ) : (
                <div className="text-sm text-muted-foreground">
                  <Trans>No eligible tasks are available to link.</Trans>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                <Trans>
                  Linking preserves the task's existing origin and status. It
                  does not resolve this Impact decision.
                </Trans>
              </div>
              {fetcher.data?.success === false && (
                <div
                  role="alert"
                  className="w-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  <Trans>Impact task could not be linked.</Trans>
                </div>
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isSubmitting || tasks.length === 0}>
                <Trans>Link task</Trans>
              </Submit>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                isDisabled={isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}

function ImpactTaskMetadata({
  task,
  candidate,
  changeNoticeId,
  changeNoticeStatus,
  canUnlink,
  canDesignate,
  onRefresh
}: {
  task: ChangeNoticeImpactTaskLink;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  changeNoticeId: string;
  changeNoticeStatus: ChangeNoticeStatus | null | undefined;
  canUnlink: boolean;
  canDesignate: boolean;
  onRefresh: () => void;
}) {
  const { locale } = useLocale();
  return (
    <div className="rounded-md border border-border/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-medium">
          {task.name ?? <Trans>Unnamed task</Trans>}
        </span>
        <Badge variant="outline" className="whitespace-nowrap">
          {taskStatusLabel(task.status)}
        </Badge>
        <Badge variant="outline" className="whitespace-nowrap">
          {taskOriginLabel(task.taskOrigin)}
        </Badge>
        {task.assignee ? (
          <EmployeeAvatar employeeId={task.assignee} size="xxs" />
        ) : (
          <span className="text-xs text-muted-foreground">
            <Trans>Unassigned</Trans>
          </span>
        )}
        {task.dueDate && (
          <span className="text-xs text-muted-foreground">
            <Trans>Due</Trans> {taskDateLabel(task.dueDate, locale)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {canDesignate && (
            <RelationshipButton
              operation="designate"
              changeNoticeId={changeNoticeId}
              candidate={candidate}
              task={task}
              disabled={!canDesignate}
              onSuccess={onRefresh}
            />
          )}
          {canUnlink && (
            <RelationshipButton
              operation="unlink"
              changeNoticeId={changeNoticeId}
              candidate={candidate}
              task={task}
              disabled={!canUnlink}
              onSuccess={onRefresh}
            />
          )}
        </div>
      </div>
      {changeNoticeStatus === "Done" &&
        task.taskOrigin !== "Impact follow-up" && (
          <div className="mt-1 text-xs text-muted-foreground">
            <Trans>Ordinary tasks are read-only after Done.</Trans>
          </div>
        )}
    </div>
  );
}

function LinkedActionTask({
  action,
  task,
  candidate,
  changeNoticeId,
  changeNoticeStatus,
  canUnlink,
  canDesignate,
  onRefresh
}: {
  action: ChangeNoticeActionTask;
  task: ChangeNoticeImpactTaskLink;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  changeNoticeId: string;
  changeNoticeStatus: ChangeNoticeStatus;
  canUnlink: boolean;
  canDesignate: boolean;
  onRefresh: () => void;
}) {
  const taskOrigin = action.taskOrigin ?? task.taskOrigin;
  return (
    <ChangeNoticeActionTaskItem
      action={action}
      changeOrderId={changeNoticeId}
      changeNoticeStatus={changeNoticeStatus}
      canEditWorkflow={false}
      showIntegrations={false}
      showDelete={false}
      onTaskMutation={onRefresh}
      headerExtras={
        <>
          <Badge variant="outline" className="whitespace-nowrap">
            {taskOriginLabel(taskOrigin)}
          </Badge>
          {canDesignate && (
            <RelationshipButton
              operation="designate"
              changeNoticeId={changeNoticeId}
              candidate={candidate}
              task={task}
              disabled={!canDesignate}
              onSuccess={onRefresh}
            />
          )}
          {canUnlink && (
            <RelationshipButton
              operation="unlink"
              changeNoticeId={changeNoticeId}
              candidate={candidate}
              task={task}
              disabled={!canUnlink}
              onSuccess={onRefresh}
            />
          )}
        </>
      }
    />
  );
}

export type ChangeNoticeImpactTaskControls = {
  canCreate: boolean;
  canLink: boolean;
  linkableTasks: ChangeNoticeActionTask[];
  canUnlink: (task: ChangeNoticeImpactTaskLink) => boolean;
  canDesignate: (task: ChangeNoticeImpactTaskLink) => boolean;
};

export function getChangeNoticeImpactTaskControls({
  candidate,
  actions,
  changeNoticeStatus,
  canUpdate
}: {
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  actions: ChangeNoticeActionTask[];
  changeNoticeStatus: ChangeNoticeStatus | null | undefined;
  canUpdate: boolean;
}): ChangeNoticeImpactTaskControls {
  const decision = candidate.decision;
  const linkedIds = new Set(
    candidate.taskLinks.map((task) => task.actionTaskId)
  );
  const canCreate =
    canUpdate && canCreateImpactTask(candidate, changeNoticeStatus);
  const relationshipsAllowed =
    canUpdate &&
    candidate.sourceAvailability !== "Restricted" &&
    decision !== null &&
    canUseImpactTaskRelationships(changeNoticeStatus);
  const cancelledCleanupAllowed =
    changeNoticeStatus !== "Cancelled" ||
    decision?.status === "Action required";
  const linkableTasks =
    relationshipsAllowed && cancelledCleanupAllowed
      ? actions.filter(
          (task) =>
            !linkedIds.has(task.id) &&
            (changeNoticeStatus !== "Cancelled" ||
              isImpactTaskOrigin(task.taskOrigin ?? "Manual"))
        )
      : [];
  const canLink = linkableTasks.length > 0;

  return {
    canCreate,
    canLink,
    linkableTasks,
    canUnlink: (task) =>
      relationshipsAllowed &&
      cancelledCleanupAllowed &&
      (changeNoticeStatus !== "Cancelled" ||
        isImpactTaskOrigin(task.taskOrigin)),
    canDesignate: (task) =>
      canUpdate &&
      candidate.sourceAvailability !== "Restricted" &&
      decision?.status === "Action required" &&
      changeNoticeStatus !== null &&
      changeNoticeStatus !== undefined &&
      changeNoticeOpenStatuses.includes(changeNoticeStatus) &&
      (task.taskOrigin === "Manual" || task.taskOrigin === "Template-owned")
  };
}

export function ChangeNoticeImpactTasks({
  changeNoticeId,
  changeNoticeStatus,
  candidate,
  actions,
  canUpdate,
  taskCoverageStatus,
  onRefresh
}: ImpactTaskProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const decision = candidate.decision;
  const linkedTasks = candidate.taskLinks;
  const controls = getChangeNoticeImpactTaskControls({
    candidate,
    actions,
    changeNoticeStatus,
    canUpdate
  });
  const hasControls = controls.canCreate || controls.canLink;
  const showNoTaskWarning =
    taskCoverageStatus === "complete" && decision?.status === "Action required";

  // A restricted source must not reveal relationship metadata or expose a task
  // control that could be used to probe the hidden decision.
  if (
    candidate.sourceAvailability === "Restricted" ||
    (linkedTasks.length === 0 && !showNoTaskWarning && !hasControls)
  ) {
    return null;
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-muted-foreground">
          <Trans>Linked tasks</Trans>
        </div>
        {hasControls && (
          <HStack spacing={1}>
            {controls.canCreate && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setCreateOpen(true)}
              >
                <Trans>Create follow-up</Trans>
              </Button>
            )}
            {controls.canLink && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                leftIcon={<LuLink />}
                onClick={() => setLinkOpen(true)}
              >
                <Trans>Link task</Trans>
              </Button>
            )}
          </HStack>
        )}
      </div>

      {linkedTasks.length === 0 ? (
        showNoTaskWarning && (
          <div className="text-xs text-amber-700 dark:text-amber-300">
            <Trans>
              No task linked. Keep a written rationale describing the follow-up
              path.
            </Trans>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {linkedTasks.map((task) => {
            const action = actions.find(
              (candidateTask) => candidateTask.id === task.actionTaskId
            );
            if (
              action &&
              changeNoticeStatus !== null &&
              changeNoticeStatus !== undefined
            ) {
              return (
                <LinkedActionTask
                  key={`${task.decisionId}-${task.actionTaskId}`}
                  action={action}
                  task={task}
                  candidate={candidate}
                  changeNoticeId={changeNoticeId}
                  changeNoticeStatus={changeNoticeStatus}
                  canUnlink={controls.canUnlink(task)}
                  canDesignate={controls.canDesignate(task)}
                  onRefresh={onRefresh}
                />
              );
            }
            return (
              <ImpactTaskMetadata
                key={`${task.decisionId}-${task.actionTaskId}`}
                task={task}
                candidate={candidate}
                changeNoticeId={changeNoticeId}
                changeNoticeStatus={changeNoticeStatus}
                canUnlink={controls.canUnlink(task)}
                canDesignate={controls.canDesignate(task)}
                onRefresh={onRefresh}
              />
            );
          })}
        </div>
      )}

      {createOpen && candidate.decision && (
        <ImpactTaskCreateDrawer
          changeNoticeId={changeNoticeId}
          candidate={candidate}
          open
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            onRefresh();
          }}
        />
      )}
      {linkOpen && decision && (
        <ImpactTaskLinkDrawer
          changeNoticeId={changeNoticeId}
          candidate={candidate}
          tasks={controls.linkableTasks}
          open
          onClose={() => setLinkOpen(false)}
          onSuccess={() => {
            setLinkOpen(false);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
