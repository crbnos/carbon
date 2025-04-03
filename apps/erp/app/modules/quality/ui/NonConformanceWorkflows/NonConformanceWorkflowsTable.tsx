import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { LuBookMarked, LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";

import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { flushSync } from "react-dom";
import { ConfirmDelete } from "~/components/Modals";
import type { NonConformanceWorkflow } from "../../types";
import { getPriorityIcon } from "../NonConformance/NonConformancePriority";

type NonConformanceWorkflowsTableProps = {
  data: NonConformanceWorkflow[];
  count: number;
};

const NonConformanceWorkflowsTable = memo(
  ({ data, count }: NonConformanceWorkflowsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedNonConformanceWorkflow, setSelectedNonConformanceWorkflow] =
      useState<NonConformanceWorkflow | null>(null);

    const columns = useMemo<ColumnDef<NonConformanceWorkflow>[]>(() => {
      const defaultColumns: ColumnDef<NonConformanceWorkflow>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <div className="flex flex-col gap-0">
              <Hyperlink to={path.to.nonConformanceWorkflow(row.original.id!)}>
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
          cell: ({ row }) => row.original.source,
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
        },
      ];
      return [...defaultColumns];
    }, []);

    const renderContextMenu = useCallback(
      (row: NonConformanceWorkflow) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "quality")}
              onClick={() => {
                navigate(`${path.to.nonConformanceWorkflow(row.id!)}`);
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
                  setSelectedNonConformanceWorkflow(row);
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
        <Table<NonConformanceWorkflow>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "quality") && (
              <New
                label="Non-Conformance Workflow"
                to={path.to.newNonConformanceWorkflow}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Non-Conformance Workflows"
          table="nonConformanceWorkflow"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedNonConformanceWorkflow && (
          <ConfirmDelete
            action={path.to.deleteNonConformanceWorkflow(
              selectedNonConformanceWorkflow.id!
            )}
            isOpen
            onCancel={() => {
              setSelectedNonConformanceWorkflow(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedNonConformanceWorkflow(null);
              deleteDisclosure.onClose();
            }}
            name={
              selectedNonConformanceWorkflow.name ?? "non-conformance template"
            }
            text="Are you sure you want to delete this non-conformance template?"
          />
        )}
      </>
    );
  }
);

NonConformanceWorkflowsTable.displayName = "NonConformanceWorkflowsTable";
export default NonConformanceWorkflowsTable;
