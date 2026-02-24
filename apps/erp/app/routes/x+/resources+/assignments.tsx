import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  BarProgress,
  HStack,
  MenuIcon,
  MenuItem,
  VStack
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookOpen,
  LuChartColumnIncreasing,
  LuCircleCheck,
  LuClock,
  LuEye,
  LuPencil,
  LuRepeat,
  LuTrash,
  LuTriangleAlert,
  LuUsers
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData
} from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import {
  getTrainingAssignmentSummary,
  getTrainingAssignments
} from "~/modules/resources";
import type { TrainingAssignmentSummaryItem } from "~/modules/resources/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Assignments",
  to: path.to.trainingAssignments
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const [summary, assignments] = await Promise.all([
    getTrainingAssignmentSummary(client, companyId),
    getTrainingAssignments(client, companyId)
  ]);

  if (summary.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(summary.error, "Error loading training assignments")
      )
    );
  }

  // Create a map of trainingId to assignment id for edit/delete links
  const assignmentsByTraining = (assignments.data ?? []).reduce(
    (acc, assignment) => {
      if (!acc[assignment.trainingId]) {
        acc[assignment.trainingId] = [];
      }
      acc[assignment.trainingId].push(assignment.id);
      return acc;
    },
    {} as Record<string, string[]>
  );

  return {
    summary: (summary.data ?? []) as TrainingAssignmentSummaryItem[],
    assignmentsByTraining
  };
}

const TrainingAssignmentsTable = memo(
  ({
    data,
    assignmentsByTraining
  }: {
    data: TrainingAssignmentSummaryItem[];
    assignmentsByTraining: Record<string, string[]>;
  }) => {
    const permissions = usePermissions();
    const fetcher = useFetcher();
    const columns = useMemo<ColumnDef<TrainingAssignmentSummaryItem>[]>(
      () => [
        {
          accessorKey: "trainingName",
          header: "Training",
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.trainingAssignmentDetail(row.original.trainingId)}
            >
              {row.original.trainingName}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookOpen />
          }
        },
        {
          accessorKey: "frequency",
          header: "Frequency",
          cell: ({ row }) => (
            <Badge variant="secondary">{row.original.frequency}</Badge>
          ),
          meta: {
            icon: <LuRepeat />
          }
        },
        {
          accessorKey: "currentPeriod",
          header: "Period",
          cell: ({ row }) => row.original.currentPeriod ?? "-",
          meta: {
            icon: <LuClock />
          }
        },
        {
          accessorKey: "totalAssigned",
          header: "Assigned",
          cell: ({ row }) => (
            <HStack spacing={2}>
              <LuUsers />
              <span className="text-muted-foreground ">
                {row.original.totalAssigned}
              </span>
            </HStack>
          ),
          meta: {
            icon: <LuUsers />
          }
        },
        {
          accessorKey: "completed",
          header: "Completed",
          cell: ({ row }) => (
            <HStack spacing={2}>
              <LuCircleCheck className="text-emerald-500" />
              <span className="text-muted-foreground">
                {row.original.completed}
              </span>
            </HStack>
          ),
          meta: {
            icon: <LuCircleCheck />
          }
        },
        {
          accessorKey: "pending",
          header: "Pending",
          cell: ({ row }) => (
            <HStack spacing={2}>
              <LuClock className="text-yellow-500" />
              <span className="text-muted-foreground text-xs">
                {row.original.pending}
              </span>
            </HStack>
          ),
          meta: {
            icon: <LuClock />
          }
        },
        {
          accessorKey: "overdue",
          header: "Overdue",
          cell: ({ row }) => (
            <HStack spacing={2}>
              <LuTriangleAlert className="text-red-500" />
              <span className="text-muted-foreground text-xs">
                {row.original.overdue}
              </span>
            </HStack>
          ),
          meta: {
            icon: <LuTriangleAlert />
          }
        },
        {
          accessorKey: "completionPercent",
          header: "Progress",
          cell: ({ row }) => (
            <BarProgress
              progress={row.original.completionPercent}
              value={`${row.original.completionPercent}%`}
            />
          ),
          meta: {
            icon: <LuChartColumnIncreasing />
          }
        }
      ],
      []
    );

    const renderContextMenu = useMemo(() => {
      return (row: TrainingAssignmentSummaryItem) => {
        const assignmentIds = assignmentsByTraining[row.trainingId] ?? [];
        // If there are multiple assignments for this training, we need a different approach
        // For now, we'll use the first one (or show nothing if no assignments)
        const assignmentId = assignmentIds[0];

        if (!assignmentId) return null;

        return (
          <>
            <MenuItem asChild>
              <Link to={path.to.trainingAssignmentDetail(row.trainingId)}>
                <MenuIcon icon={<LuEye />} />
                View Status
              </Link>
            </MenuItem>
            {permissions.can("update", "resources") && (
              <MenuItem asChild>
                <Link to={path.to.trainingAssignment(assignmentId)}>
                  <MenuIcon icon={<LuPencil />} />
                  Edit Assignment
                </Link>
              </MenuItem>
            )}
            {permissions.can("delete", "resources") && (
              <MenuItem
                onClick={() => {
                  fetcher.submit(null, {
                    method: "post",
                    action: path.to.deleteTrainingAssignment(assignmentId)
                  });
                }}
              >
                <MenuIcon icon={<LuTrash />} />
                Delete Assignment
              </MenuItem>
            )}
          </>
        );
      };
    }, [assignmentsByTraining, permissions, fetcher]);

    return (
      <Table<TrainingAssignmentSummaryItem>
        data={data}
        columns={columns}
        count={data.length}
        primaryAction={
          permissions.can("create", "resources") && (
            <New label="Assignment" to={path.to.newTrainingAssignment} />
          )
        }
        title="Training Assignments"
        table="trainingAssignmentSummary"
        renderContextMenu={renderContextMenu}
      />
    );
  }
);

TrainingAssignmentsTable.displayName = "TrainingAssignmentsTable";

export default function TrainingAssignmentsRoute() {
  const { summary, assignmentsByTraining } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrainingAssignmentsTable
        data={summary}
        assignmentsByTraining={assignmentsByTraining}
      />
      <Outlet />
    </VStack>
  );
}
