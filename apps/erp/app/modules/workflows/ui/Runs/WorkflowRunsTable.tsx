import { HStack } from "@carbon/react";
import { formatDateTime, formatDurationMilliseconds } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuClock,
  LuHash,
  LuLink,
  LuUser,
  LuZap
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import type { WorkflowRun } from "../../workflows.service";
import { labelText } from "../Builder/nodes/meta";
import { EntityRecordLink } from "./EntityRecordLink";
import { RunsLiveUpdates } from "./RunLiveUpdates";
import { RunStatus, TestRunBadge } from "./RunStatus";

type WorkflowRunsTableProps = {
  data: WorkflowRun[];
  count: number;
};

const WorkflowRunsTable = memo(({ data, count }: WorkflowRunsTableProps) => {
  const { t } = useLingui();
  const { company } = useUser();

  const hasInFlight = data.some(
    (row) => row.status === "Queued" || row.status === "Running"
  );

  const columns = useMemo<ColumnDef<WorkflowRun>[]>(
    () => [
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.workflowRun(row.original.id)}>
            <HStack spacing={2}>
              <RunStatus status={row.original.status} />
              {row.original.isTest && <TestRunBadge />}
            </HStack>
          </Hyperlink>
        ),
        meta: { icon: <LuHash /> }
      },
      {
        accessorKey: "workflowId",
        header: t`Workflow`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.workflow(row.original.workflowId)}>
            {(row.original.workflow as { name?: string } | null)?.name ??
              row.original.workflowId}
          </Hyperlink>
        ),
        meta: {
          icon: <LuLink />,
          filterHeader: t`Workflow`,
          exportValue: (row: WorkflowRun) =>
            (row.workflow as { name?: string } | null)?.name ?? row.workflowId
        }
      },
      {
        accessorKey: "eventId",
        header: t`Trigger`,
        cell: ({ row }) => {
          const eventId = row.original.eventId;
          if (!eventId) return "—";
          return labelText(eventId) ?? eventId;
        },
        meta: { icon: <LuZap /> }
      },
      {
        accessorKey: "triggerRecordId",
        header: t`Record`,
        cell: ({ row }) => {
          const { triggerTable, triggerRecordId } = row.original;
          if (!triggerTable || !triggerRecordId) return "—";
          return <EntityRecordLink table={triggerTable} id={triggerRecordId} />;
        },
        meta: {
          icon: <LuLink />,
          filterHeader: t`Record`,
          exportValue: (row: WorkflowRun) =>
            row.triggerRecordId
              ? `${row.triggerTable} ${row.triggerRecordId}`
              : ""
        }
      },
      {
        accessorKey: "startedAt",
        header: t`Started`,
        cell: ({ row }) => {
          const ts = row.original.startedAt ?? row.original.createdAt;
          return ts ? formatDateTime(ts) : "—";
        },
        meta: { icon: <LuCalendar /> }
      },
      {
        accessorKey: "durationMs",
        header: t`Duration`,
        cell: ({ row }) => {
          const ms = row.original.durationMs;
          return ms != null ? formatDurationMilliseconds(ms) : "—";
        },
        meta: { icon: <LuClock /> }
      },
      {
        accessorKey: "ownerId",
        header: t`Owner`,
        cell: ({ row }) => <EmployeeAvatar employeeId={row.original.ownerId} />,
        meta: {
          icon: <LuUser />,
          filterHeader: t`Owner`,
          exportValue: (row: WorkflowRun) => row.ownerId ?? ""
        }
      },
      {
        id: "depth",
        accessorKey: "depth",
        header: t`Chain`,
        cell: ({ row }) => {
          const { depth, causedByRunId } = row.original;
          if (!depth || depth === 0) return "—";
          if (causedByRunId) {
            return (
              <Hyperlink to={path.to.workflowRun(causedByRunId)}>
                {t`Hop ${depth}`}
              </Hyperlink>
            );
          }
          return t`Hop ${depth}`;
        },
        meta: { icon: <LuHash /> }
      }
    ],
    [t]
  );

  return (
    <>
      {hasInFlight && <RunsLiveUpdates companyId={company.id} />}
      <Table<WorkflowRun>
        data={data}
        columns={columns}
        count={count}
        title={t`Runs`}
        table="workflowRun"
        withPagination
      />
    </>
  );
});

WorkflowRunsTable.displayName = "WorkflowRunsTable";
export default WorkflowRunsTable;
