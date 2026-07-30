import { assertIsPost, error, success } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  generateHTML,
  HStack,
  IconButton,
  useDebounce,
  useDisclosure,
  useMode,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useRef, useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  useFetcher,
  useLoaderData,
  useParams,
  useSubmit
} from "react-router";
import z from "zod";
import { zfd } from "zod-form-data";
import { actionTaskStatusActions } from "~/components/ActionTasks/ActionTaskCard";
import { getSupplier } from "~/modules/purchasing";
import type { IssueActionTask } from "~/modules/quality";
import {
  getIssueActionTasks,
  getIssueFromExternalLink,
  nonConformanceTaskStatus,
  updateIssueTaskContent,
  updateIssueTaskStatus
} from "~/modules/quality";
import { TaskProgress } from "~/modules/quality/ui/Issue";
import IssueStatus from "~/modules/quality/ui/Issue/IssueStatus";
import { getCompany } from "~/modules/settings";
import { getExternalLink } from "~/modules/shared";
import { path } from "~/utils/path";
import { ErrorMessage } from "./quote.$id";

export const meta = () => {
  return [{ title: "SCAR Report" }];
};

enum IssueState {
  Valid,
  NotFound
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return {
      state: IssueState.NotFound,
      data: null
    };
  }

  const serviceRole = getCarbonServiceRole();
  const externalLink = await getExternalLink(serviceRole, id);
  if (!externalLink.data || !externalLink.data?.documentId) {
    return {
      state: IssueState.NotFound,
      data: null
    };
  }

  const issue = await getIssueFromExternalLink(
    serviceRole,
    externalLink.data.documentId
  );
  if (!issue.data) {
    return {
      state: IssueState.NotFound,
      data: null
    };
  }

  const [company, supplier, actionTasks] = await Promise.all([
    getCompany(serviceRole, externalLink.data.companyId),
    getSupplier(serviceRole, issue.data.supplierId),
    getIssueActionTasks(
      serviceRole,
      issue.data.nonConformanceId,
      externalLink.data.companyId,
      issue.data.supplierId
    )
  ]);

  return {
    state: IssueState.Valid,
    data: {
      issue: issue.data.nonConformance,
      company: company.data,
      supplier: supplier.data,
      actionTasks: actionTasks.data
    }
  };
}

export const scarValidator = z.object({
  taskId: zfd.text(z.string()),
  type: z.enum(["action"]),
  supplierId: zfd.text(z.string()),
  status: z.enum(nonConformanceTaskStatus).optional(),
  content: z
    .string()
    .optional()
    .transform((str, ctx) => {
      if (!str) {
        return;
      }
      try {
        return JSON.parse(str);
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        ctx.addIssue({ code: "custom", message: "Invalid JSON" });
        return z.NEVER;
      }
    })
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const serviceRole = getCarbonServiceRole();

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const externalLink = await getExternalLink(serviceRole, id);
  if (!externalLink.data || !externalLink.data?.documentId) {
    throw new Error("Could not find id");
  }

  const issue = await getIssueFromExternalLink(
    serviceRole,
    externalLink.data.documentId
  );
  if (!issue.data) {
    throw new Error("Could not find the issue");
  }

  if (issue.data.nonConformance.status === "Closed") {
    throw new Error("Issue has been closed already. Unable to make changes");
  }
  const formData = await request.formData();
  const validation = await validator(scarValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const tasks = await getIssueActionTasks(
    serviceRole,
    issue.data.nonConformanceId,
    externalLink.data.companyId,
    issue.data.supplierId
  );

  const isTaskValid = tasks.data?.find((t) => t.id === validation.data.taskId);
  if (!isTaskValid) {
    throw new Error("Invalid task id");
  }

  if (validation.data.status) {
    const statusUpdate = await updateIssueTaskStatus(serviceRole, {
      id: validation.data.taskId,
      status: validation.data.status,
      type: validation.data.type
    });

    if (statusUpdate.error) {
      return data(
        {
          success: false
        },
        await flash(
          request,
          error(statusUpdate.error, "Failed to update task status")
        )
      );
    }

    return data(
      {
        success: true
      },
      await flash(request, success("Updated task status"))
    );
  }

  if (validation.data.content) {
    const contentUpdate = await updateIssueTaskContent(serviceRole, {
      id: validation.data.taskId,
      content: validation.data.content,
      type: validation.data.type
    });

    if (contentUpdate.error) {
      return data(
        {
          success: false
        },
        await flash(
          request,
          error(contentUpdate.error, "Failed to update content")
        )
      );
    }

    return { succes: true };
  }

  return {
    success: true
  };
}

const Header = ({
  company,
  issue,
  supplier
}: {
  company: IssueData["company"];
  issue: IssueData["issue"];
  supplier: IssueData["supplier"];
}) => (
  <CardHeader className="flex flex-col gap-4">
    <div className="flex items-center justify-center w-full">
      <IssueStatus status={issue.status} />
    </div>
    <div className="flex sm:flex-row items-start sm:items-start justify-between space-y-4 sm:space-y-2">
      <div className="flex items-center space-x-4">
        <div>
          <CardTitle className="text-3xl">{company?.name ?? ""}</CardTitle>
          {issue?.nonConformanceId && (
            <p className="text-lg text-muted-foreground">
              {issue.nonConformanceId}
            </p>
          )}
          {issue?.name && (
            <p className="text-lg text-muted-foreground">{issue.name}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 items-end justify-start">
        <p className="text-xl font-medium">{supplier?.name ?? ""}</p>
      </div>
    </div>
  </CardHeader>
);

function useTaskStatus({
  task,
  type,
  onChange
}: {
  task: {
    id?: string;
    status: IssueActionTask["status"];
    supplierId: string | null;
  };
  type: "action" | "approval" | "review";
  onChange?: (status: IssueActionTask["status"]) => void;
}) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find external quote id");

  const submit = useSubmit();

  const onOperationStatusChange = useCallback(
    (taskId: string, status: IssueActionTask["status"]) => {
      onChange?.(status);
      submit(
        {
          taskId,
          status,
          type,
          supplierId: task.supplierId ?? ""
        },
        {
          method: "post",
          action: path.to.externalScar(id),
          navigate: false,
          fetcherKey: `externalScar:${id}`
        }
      );
    },
    [onChange, task.supplierId, type, id, submit]
  );

  const currentStatus = task.status;

  return {
    currentStatus,
    onOperationStatusChange
  };
}

function useTaskNotes({
  initialContent,
  taskId,
  supplierId,
  type
}: {
  initialContent: JSONContent;
  taskId: string;
  supplierId: string;
  type: "action" | "approval" | "review";
}) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find external quote id");

  const fetcher = useFetcher<typeof action>();
  const [content, setContent] = useState(initialContent ?? {});

  const onUpdateContent = useDebounce(
    async (content: JSONContent) => {
      fetcher.submit(
        { taskId, type, supplierId, content: JSON.stringify(content) },
        { method: "post", action: path.to.externalScar(id) }
      );
    },
    1000,
    true
  );

  return {
    content,
    setContent,
    onUpdateContent
  };
}

export function TaskItem({
  task,
  type,
  isDisabled = false
}: {
  task: IssueActionTask;
  type: "action" | "review";
  isDisabled?: boolean;
  permissionsOverride?: Permissions;
}) {
  // const permissions = usePermissions();
  const { t } = useLingui();
  const disclosure = useDisclosure({
    defaultIsOpen: true
  });
  const { currentStatus, onOperationStatusChange } = useTaskStatus({
    task,
    type
  });
  const statusAction = actionTaskStatusActions[currentStatus];
  const { content, setContent, onUpdateContent } = useTaskNotes({
    initialContent: (task.notes ?? {}) as JSONContent,
    taskId: task.id!,
    type,
    supplierId: task.supplierId ?? ""
  });

  const hasStartedRef = useRef(false);

  const taskTitle = task.name;
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
          aria-label={t`Open task details`}
          className={cn(disclosure.isOpen && "rotate-90")}
        />
      </div>

      {disclosure.isOpen && (
        <div className="px-4 py-2 rounded">
          {!isDisabled ? (
            <Editor
              className="w-full min-h-[100px]"
              initialValue={content}
              disableFileUpload
              onChange={(value) => {
                setContent(value);
                onUpdateContent(value);

                // Auto-start issue when typing in task if issue status is "Registered"
                if (
                  task.status === "Pending" &&
                  !hasStartedRef.current &&
                  value?.content?.some((node: any) => node.content?.length > 0)
                ) {
                  hasStartedRef.current = true;
                  onOperationStatusChange(task.id, "In Progress");
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
      <div className="bg-muted/30 border-t px-4 py-2 flex justify-end w-full">
        <HStack>
          <Button
            isDisabled={isDisabled}
            leftIcon={statusAction.icon}
            variant="secondary"
            size="sm"
            onClick={() => {
              onOperationStatusChange(task.id!, statusAction.next);
            }}
          >
            {statusAction.action}
          </Button>
        </HStack>
      </div>
    </div>
  );
}

export function TaskList({
  tasks,
  isDisabled
}: {
  tasks: IssueActionTask[];
  isDisabled: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <>
      <HStack className="justify-center w-full">
        <TaskProgress tasks={tasks} className="pr-0" />
      </HStack>

      <VStack spacing={3}>
        {tasks
          .sort((a, b) => a.name?.localeCompare(b.name ?? "") ?? 0)
          .map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              type="action"
              isDisabled={isDisabled}
            />
          ))}
      </VStack>
    </>
  );
}

const Issue = ({ data }: { data: IssueData }) => {
  const { company, issue, actionTasks, supplier } = data;

  const { id } = useParams();
  if (!id) throw new Error("Could not find external quote id");

  const mode = useMode();
  const logo = mode === "dark" ? company?.logoDark : company?.logoLight;

  return (
    <VStack spacing={8} className="w-full items-center p-2 md:p-8">
      {logo && (
        <img
          src={logo}
          alt={company?.name ?? ""}
          className="w-auto mx-auto max-w-5xl"
        />
      )}
      <Card className="w-full max-w-5xl mx-auto gap-4">
        <Header company={company} issue={issue} supplier={supplier} />
        <CardContent className="gap-4">
          {actionTasks?.length ? (
            <TaskList
              tasks={actionTasks}
              isDisabled={issue.status === "Closed"}
            />
          ) : null}
        </CardContent>
      </Card>
    </VStack>
  );
};

type IssueData = NonNullable<
  // @ts-expect-error TS2339 - TODO: fix type
  Awaited<ReturnType<Awaited<ReturnType<typeof loader>>["json"]>>["data"]
>;

export default function ExternalQuote() {
  const { state, data } = useLoaderData<typeof loader>();
  const { t } = useLingui();

  switch (state) {
    case IssueState.Valid:
      if (data) {
        return <Issue data={data as IssueData} />;
      }
      return (
        <ErrorMessage
          title={t`Issue not found`}
          message={t`Oops! The link you're trying to access is not valid.`}
        />
      );
    case IssueState.NotFound:
      return (
        <ErrorMessage
          title={t`Issue not found`}
          message={t`Oops! The link you're trying to access is not valid.`}
        />
      );
  }
}
