// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  BarProgress,
  HStack,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  RecordOutlet,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { Link, useFetcher, useLoaderData } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { getTrainingAssignmentSummary } from "~/modules/resources";
import type { TrainingAssignmentSummaryItem } from "~/modules/resources/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Assignments`,
  to: path.to.trainingAssignments
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const summary = await getTrainingAssignmentSummary(client, companyId);

  if (summary.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(summary.error, "Error loading training assignments")
      )
    );
  }

  return {
    summary: (summary.data ?? []) as TrainingAssignmentSummaryItem[]
  };
}

const TrainingAssignmentsTable = memo(
  ({ data }: { data: TrainingAssignmentSummaryItem[] }) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const fetcher = useFetcher();
    const columns = useMemo<ColumnDef<TrainingAssignmentSummaryItem>[]>(
      () => [
        {
          accessorKey: "trainingName",
          header: t`Training`,
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.trainingAssignmentDetail(
                row.original.trainingAssignmentId
              )}
            >
              <HStack spacing={2}>
                <span>{row.original.trainingName}</span>
                {row.original.isExternal && (
                  <Badge variant="outline">
                    <Trans>External</Trans>
                  </Badge>
                )}
              </HStack>
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookOpen />
          }
        },
        {
          accessorKey: "frequency",
          header: t`Frequency`,
          cell: ({ row }) => (
            <Badge variant="secondary">{row.original.frequency}</Badge>
          ),
          meta: {
            icon: <LuRepeat />
          }
        },
        {
          accessorKey: "currentPeriod",
          header: t`Period`,
          cell: ({ row }) => row.original.currentPeriod ?? "-",
          meta: {
            mobile: "P3",
            icon: <LuClock />
          }
        },
        {
          accessorKey: "totalAssigned",
          header: t`Assigned`,
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
          header: t`Completed`,
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
          header: t`Pending`,
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
          header: t`Overdue`,
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
          header: t`Progress`,
          cell: ({ row }) => (
            <BarProgress
              progress={row.original.completionPercent}
              value={`${row.original.completionPercent}%`}
            />
          ),
          meta: {
            mobile: "P2",
            icon: <LuChartColumnIncreasing />
          }
        }
      ],
      [t]
    );

    const renderContextMenu = useMemo(() => {
      return (row: TrainingAssignmentSummaryItem) => {
        const assignmentId = row.trainingAssignmentId;

        return (
          <>
            <MenuItem shortcut={MENU_ITEM_SHORTCUTS.view} asChild>
              <Link to={path.to.trainingAssignmentDetail(assignmentId)}>
                <MenuIcon icon={<LuEye />} />
                <Trans>View Status</Trans>
              </Link>
            </MenuItem>
            {permissions.can("update", "resources") && (
              <MenuItem shortcut={MENU_ITEM_SHORTCUTS.edit} asChild>
                <Link to={path.to.trainingAssignment(assignmentId)}>
                  <MenuIcon icon={<LuPencil />} />
                  <Trans>Edit Assignment</Trans>
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
                <Trans>Delete Assignment</Trans>
              </MenuItem>
            )}
          </>
        );
      };
    }, [permissions, fetcher]);

    return (
      <Table<TrainingAssignmentSummaryItem>
        data={data}
        columns={columns}
        count={data.length}
        primaryAction={
          permissions.can("create", "resources") && (
            <New label={t`Assignment`} to={path.to.newTrainingAssignment} />
          )
        }
        title={t`Training Assignments`}
        table="trainingAssignmentSummary"
        renderContextMenu={renderContextMenu}
      />
    );
  }
);

TrainingAssignmentsTable.displayName = "TrainingAssignmentsTable";

export default function TrainingAssignmentsRoute() {
  const { summary } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrainingAssignmentsTable data={summary} />
      <RecordOutlet />
    </VStack>
  );
}
