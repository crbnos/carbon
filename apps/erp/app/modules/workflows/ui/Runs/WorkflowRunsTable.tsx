// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack } from "@carbon/react";
import { formatDateTime, formatDurationMilliseconds } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useRef } from "react";
import {
  LuCalendar,
  LuClock,
  LuHash,
  LuLink,
  LuUser,
  LuZap
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import type { InfiniteOptions } from "~/components/Table";
import { path } from "~/utils/path";
import type { WorkflowRun } from "../../workflows.service";
import { useWorkflowEventLabel } from "../Builder/catalog";
import { EntityRecordLink } from "./EntityRecordLink";
import { RunsLiveUpdates } from "./RunLiveUpdates";
import { RunStatus, TestRunBadge } from "./RunStatus";
import { WORKFLOW_RUN_LIST_EXPORT_VALUES } from "./workflow-run-list-export";

export type WorkflowRunListItem = WorkflowRun & { recordName?: string };

type WorkflowRunsTableProps = {
  data: WorkflowRunListItem[];
  count: number;
  infinite: InfiniteOptions;
};

const WorkflowRunsTable = memo((props: WorkflowRunsTableProps) => {
  const { data, count, infinite } = props;
  const { t } = useLingui();
  // A fresh closure each render, so the columns memo reads it through a ref rather than
  // rebuilding every column on every render.
  const eventLabel = useWorkflowEventLabel();
  const eventLabelRef = useRef(eventLabel);
  eventLabelRef.current = eventLabel;

  const hasInFlight = data.some(
    (row) => row.status === "Queued" || row.status === "Running"
  );

  const columns = useMemo<ColumnDef<WorkflowRunListItem>[]>(
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
        meta: { mobile: "P1", icon: <LuHash /> }
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
          mobile: "P3",
          icon: <LuLink />,
          filterHeader: t`Workflow`,
          exportValue: WORKFLOW_RUN_LIST_EXPORT_VALUES.workflowId
        }
      },
      {
        accessorKey: "eventId",
        header: t`Trigger`,
        cell: ({ row }) => {
          const eventId = row.original.eventId;
          if (!eventId) return "—";
          return eventLabelRef.current(eventId, eventId);
        },
        meta: { icon: <LuZap /> }
      },
      {
        accessorKey: "triggerRecordId",
        header: t`Record`,
        cell: ({ row }) => {
          const { triggerTable, triggerRecordId, recordName } = row.original;
          if (!triggerTable || !triggerRecordId) return "—";
          return (
            <EntityRecordLink
              table={triggerTable}
              id={triggerRecordId}
              name={recordName}
            />
          );
        },
        meta: {
          icon: <LuLink />,
          filterHeader: t`Record`,
          exportValue: WORKFLOW_RUN_LIST_EXPORT_VALUES.triggerRecordId
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
        meta: { mobile: "P2", icon: <LuClock /> }
      },
      {
        accessorKey: "ownerId",
        header: t`Owner`,
        cell: ({ row }) => <EmployeeAvatar employeeId={row.original.ownerId} />,
        meta: {
          icon: <LuUser />,
          filterHeader: t`Owner`,
          exportValue: (row: WorkflowRunListItem) => row.ownerId ?? ""
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
      {hasInFlight && <RunsLiveUpdates />}
      <Table<WorkflowRunListItem>
        data={data}
        infinite={infinite}
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
