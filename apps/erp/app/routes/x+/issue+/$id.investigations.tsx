import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack,
} from "@carbon/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";

import type { Issue, IssueInvestigationTask } from "~/modules/quality";
import { getIssueInvestigationTasks } from "~/modules/quality";
import { TaskItem, TaskProgress } from "~/modules/quality/ui/Issue/IssueTask";
import { path } from "~/utils/path";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Non-conformance ID is required");

  const investigationTasks = await getIssueInvestigationTasks(
    client,
    id,
    companyId
  );

  return json({
    investigationTasks: investigationTasks.data || [],
  });
}

export default function IssueTasks() {
  const { investigationTasks } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Non-conformance ID is required");
  const routeData = useRouteData<{
    nonConformance: Issue;
  }>(path.to.issue(id));

  return (
    <VStack spacing={2} className="w-full">
      <InvestigationTasksList
        tasks={investigationTasks}
        isDisabled={routeData?.nonConformance.status === "Closed"}
      />
    </VStack>
  );
}

function InvestigationTasksList({
  tasks,
  isDisabled,
}: {
  tasks: IssueInvestigationTask[];
  isDisabled: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <Card className="w-full min-h-[calc(100vh-115px)]" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Investigations
          </CardTitle>
        </CardHeader>
        <TaskProgress tasks={tasks} />
      </HStack>
      <CardContent>
        <VStack spacing={3}>
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              type="investigation"
              isDisabled={isDisabled}
            />
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
}
