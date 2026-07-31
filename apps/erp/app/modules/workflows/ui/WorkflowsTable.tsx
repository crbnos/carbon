import {
  Badge,
  Button,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCalendar,
  LuCirclePlus,
  LuPencil,
  LuTag,
  LuText,
  LuToggleLeft,
  LuTrash,
  LuUser,
  LuWorkflow
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { Workflow } from "../workflows.service";
import { WorkflowActiveSwitch } from "./WorkflowActiveSwitch";
import WorkflowForm from "./WorkflowForm";

type WorkflowsTableProps = {
  data: Workflow[];
  count: number;
  versionNumbers: Record<string, number>;
};

const WorkflowsTable = memo(
  ({ data, count, versionNumbers }: WorkflowsTableProps) => {
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();
    const newDisclosure = useDisclosure();
    const renameDisclosure = useDisclosure();
    const deleteDisclosure = useDisclosure();
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
          cell: ({ row }) => row.original.description ?? "—",
          meta: { icon: <LuText /> }
        },
        {
          accessorKey: "ownerId",
          header: t`Owner`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.ownerId} />
          ),
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "activeVersionId",
          header: t`Live Version`,
          cell: ({ row }) => {
            const versionId = row.original.activeVersionId;
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
          accessorKey: "active",
          header: t`Active`,
          cell: ({ row }) => (
            <WorkflowActiveSwitch
              workflowId={row.original.id}
              active={row.original.active}
            />
          ),
          meta: { icon: <LuToggleLeft /> }
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
      [t, versionNumbers]
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
      [navigate, permissions, renameDisclosure, deleteDisclosure, t]
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
