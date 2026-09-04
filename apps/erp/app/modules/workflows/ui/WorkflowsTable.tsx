import {
  Badge,
  Button,
  MenuIcon,
  MenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { formatDate, formatRelativeTime } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBadgeCheck,
  LuCalendar,
  LuCirclePlus,
  LuCircleStop,
  LuHistory,
  LuPencil,
  LuTag,
  LuText,
  LuTrash,
  LuUser,
  LuWorkflow
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { Workflow, WorkflowLastRun } from "../workflows.service";
import { ConfirmUnpublishWorkflow } from "./ConfirmUnpublishWorkflow";
import { RunStatus } from "./Runs/RunStatus";
import WorkflowForm from "./WorkflowForm";

type WorkflowsTableProps = {
  data: Workflow[];
  count: number;
  versionNumbers: Record<string, number>;
  lastRuns: Record<string, WorkflowLastRun>;
};

const WorkflowsTable = memo(
  ({ data, count, versionNumbers, lastRuns }: WorkflowsTableProps) => {
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();
    const [people] = usePeople();
    const newDisclosure = useDisclosure();
    const renameDisclosure = useDisclosure();
    const deleteDisclosure = useDisclosure();
    const unpublishDisclosure = useDisclosure();
    const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(
      null
    );

    const columns = useMemo<ColumnDef<Workflow>[]>(
      () => [
        {
          accessorKey: "name",

          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.workflow(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: { icon: <LuWorkflow /> }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => {
            const description = row.original.description;
            if (!description) return "—";
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate">{description}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm whitespace-pre-wrap">
                  {description}
                </TooltipContent>
              </Tooltip>
            );
          },
          meta: { icon: <LuText /> }
        },
        {
          id: "status",
          header: t`Status`,
          cell: ({ row }) => {
            const isPublished = Boolean(row.original.publishedVersionId);
            return isPublished ? (
              <Badge variant="green">{t`Published`}</Badge>
            ) : (
              <Badge variant="gray">{t`Draft`}</Badge>
            );
          },
          meta: {
            icon: <LuBadgeCheck />,
            filterHeader: t`Status`,
            filter: {
              type: "static",
              options: [
                { value: "Published", label: t`Published` },
                { value: "Draft", label: t`Draft` }
              ]
            },
            exportValue: (row: Workflow) =>
              row.publishedVersionId ? "Published" : "Draft"
          }
        },
        {
          accessorKey: "ownerId",
          header: t`Owner`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.ownerId} />
          ),
          meta: {
            icon: <LuUser />,
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            }
          }
        },
        {
          accessorKey: "publishedVersionId",
          header: t`Published Version`,
          cell: ({ row }) => {
            const versionId = row.original.publishedVersionId;
            const versionNumber = versionId
              ? versionNumbers[versionId]
              : undefined;
            return versionNumber ? (
              <Badge variant="outline">v{versionNumber}</Badge>
            ) : (
              "—"
            );
          },
          meta: { icon: <LuTag /> }
        },
        {
          id: "lastRun",
          header: t`Last Run`,
          cell: ({ row }) => {
            const lastRun = lastRuns[row.original.id];
            if (!lastRun?.runId || !lastRun.status) return "—";
            const ts = lastRun.completedAt ?? lastRun.createdAt;
            return (
              <Hyperlink
                to={path.to.workflowRun(lastRun.runId)}
                className="flex items-center gap-1.5"
              >
                <RunStatus status={lastRun.status} />
                {ts && (
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(ts)}
                  </span>
                )}
              </Hyperlink>
            );
          },
          meta: {
            icon: <LuHistory />,
            filterHeader: t`Last Run`,
            exportValue: (row: Workflow) => lastRuns[row.id]?.status ?? ""
          }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated`,
          cell: ({ row }) =>
            row.original.updatedAt
              ? formatDate(row.original.updatedAt)
              : formatDate(row.original.createdAt),
          meta: { icon: <LuCalendar /> }
        }
      ],
      [t, versionNumbers, lastRuns, people]
    );

    const renderContextMenu = useCallback(
      (row: Workflow) => (
        <>
          <MenuItem onClick={() => navigate(path.to.workflow(row.id))}>
            <MenuIcon icon={<LuWorkflow />} />
            {t`Open Workflow`}
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("update", "workflows")}
            onClick={() => {
              flushSync(() => setSelectedWorkflow(row));
              renameDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            {t`Rename Workflow`}
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("update", "workflows") || !row.publishedVersionId
            }
            onClick={() => {
              flushSync(() => setSelectedWorkflow(row));
              unpublishDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuCircleStop />} />
            {t`Unpublish`}
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "workflows")}
            onClick={() => {
              flushSync(() => setSelectedWorkflow(row));
              deleteDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            {t`Delete Workflow`}
          </MenuItem>
        </>
      ),
      [
        navigate,
        permissions,
        renameDisclosure,
        unpublishDisclosure,
        deleteDisclosure,
        t
      ]
    );

    return (
      <>
        <Table<Workflow>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "workflows") && (
              <Button
                leftIcon={<LuCirclePlus />}
                onClick={newDisclosure.onOpen}
              >
                {t`New Workflow`}
              </Button>
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Workflows`}
          table="workflow"
          withSavedView
        />
        {newDisclosure.isOpen && (
          <WorkflowForm
            initialValues={{ name: "", description: "" }}
            onClose={newDisclosure.onClose}
          />
        )}
        {renameDisclosure.isOpen && selectedWorkflow && (
          <WorkflowForm
            initialValues={{
              id: selectedWorkflow.id,
              name: selectedWorkflow.name,
              description: selectedWorkflow.description ?? ""
            }}
            onClose={() => {
              setSelectedWorkflow(null);
              renameDisclosure.onClose();
            }}
          />
        )}
        {unpublishDisclosure.isOpen && selectedWorkflow && (
          <ConfirmUnpublishWorkflow
            workflowId={selectedWorkflow.id}
            name={selectedWorkflow.name}
            onClose={() => {
              setSelectedWorkflow(null);
              unpublishDisclosure.onClose();
            }}
          />
        )}
        {deleteDisclosure.isOpen && selectedWorkflow && (
          <ConfirmDelete
            action={path.to.workflowDelete(selectedWorkflow.id)}
            isOpen
            onCancel={() => {
              setSelectedWorkflow(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedWorkflow(null);
              deleteDisclosure.onClose();
            }}
            name={selectedWorkflow.name}
            text={t`Are you sure you want to delete this workflow? Its versions and run history go with it.`}
          />
        )}
      </>
    );
  }
);

WorkflowsTable.displayName = "WorkflowsTable";
export default WorkflowsTable;
