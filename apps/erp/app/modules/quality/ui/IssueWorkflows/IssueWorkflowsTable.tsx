import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuChartNoAxesColumnIncreasing,
  LuDna,
  LuPencil,
  LuTrash,
} from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";

import { flushSync } from "react-dom";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { IssueWorkflow } from "../../types";
import { getPriorityIcon, getSourceIcon } from "../Issue/IssueIcons";

type IssueWorkflowsTableProps = {
  data: IssueWorkflow[];
  count: number;
};

const IssueWorkflowsTable = memo(
  ({ data, count }: IssueWorkflowsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedIssueWorkflow, setSelectedIssueWorkflow] =
      useState<IssueWorkflow | null>(null);

    const columns = useMemo<ColumnDef<IssueWorkflow>[]>(() => {
      const defaultColumns: ColumnDef<IssueWorkflow>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <div className="flex flex-col gap-0">
              <Hyperlink to={path.to.issueWorkflow(row.original.id!)}>
                {row.original.name}
              </Hyperlink>
            </div>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          accessorKey: "source",
          header: "Default Source",
          cell: ({ row }) => (
            <div className="flex gap-2 items-center">
              {getSourceIcon(row.original.source, false)}
              {row.original.source}
            </div>
          ),
          meta: {
            icon: <LuDna />,
          },
        },
        {
          accessorKey: "priority",
          header: "Default Priority",
          cell: ({ row }) => (
            <div className="flex gap-2 items-center">
              {getPriorityIcon(row.original.priority, false)}
              {row.original.priority}
            </div>
          ),
          meta: {
            icon: <LuChartNoAxesColumnIncreasing />,
          },
        },
      ];
      return [...defaultColumns];
    }, []);

    const renderContextMenu = useCallback(
      (row: IssueWorkflow) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                navigate(`${path.to.issueWorkflow(row.id!)}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Template
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedIssueWorkflow(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Template
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure]
    );

    return (
      <>
        <Table<IssueWorkflow>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "quality") && (
              <New label="Issue Workflow" to={path.to.newIssueWorkflow} />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Issue Workflows"
          table="nonConformanceWorkflow"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedIssueWorkflow && (
          <ConfirmDelete
            action={path.to.deleteIssueWorkflow(selectedIssueWorkflow.id!)}
            isOpen
            onCancel={() => {
              setSelectedIssueWorkflow(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedIssueWorkflow(null);
              deleteDisclosure.onClose();
            }}
            name={selectedIssueWorkflow.name ?? "issue workflow"}
            text="Are you sure you want to delete this issue workflow?"
          />
        )}
      </>
    );
  }
);

IssueWorkflowsTable.displayName = "IssueWorkflowsTable";
export default IssueWorkflowsTable;
