import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack,
} from "@carbon/react";
import { useLoaderData, useParams } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { useRouteData } from "~/hooks";

import type { Issue, IssueActionTask } from "~/modules/quality";
import { getIssueActionTasks } from "~/modules/quality";
import { TaskItem, TaskProgress } from "~/modules/quality/ui/Issue/IssueTask";
import { path } from "~/utils/path";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Non-conformance ID is required");

  const actionTasks = await getIssueActionTasks(client, id, companyId);

  return json({
    actionTasks: actionTasks.data || [],
  });
}

export default function IssueActions() {
  const { actionTasks } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Non-conformance ID is required");
  const routeData = useRouteData<{
    nonConformance: Issue;
  }>(path.to.issue(id));

  return (
    <VStack spacing={2} className="w-full">
      <ActionTasksList
        tasks={actionTasks}
        isDisabled={routeData?.nonConformance.status === "Closed"}
      />
    </VStack>
  );
}

function ActionTasksList({
  tasks,
  isDisabled,
}: {
  tasks: IssueActionTask[];
  isDisabled: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <Card className="w-full min-h-[calc(100vh-115px)]" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Actions</CardTitle>
        </CardHeader>
        <TaskProgress tasks={tasks} />
      </HStack>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
