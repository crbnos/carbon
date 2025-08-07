import { Checkbox, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { LuPencil, LuSquareCheck, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { RequiredAction } from "../../types";

type RequiredActionsTableProps = {
  data: RequiredAction[];
  count: number;
};

const RequiredActionsTable = memo(
  ({ data, count }: RequiredActionsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedRequiredAction, setSelectedRequiredAction] =
      useState<RequiredAction | null>(null);

    const columns = useMemo<ColumnDef<RequiredAction>[]>(() => {
      const defaultColumns: ColumnDef<RequiredAction>[] = [
        {
          accessorKey: "name",
          header: "Required Action",
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuSquareCheck />,
          },
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: ({ row }) => <Checkbox checked={row.original.active} />,
        },
      ];
      return defaultColumns;
    }, []);

    const renderContextMenu = useCallback(
      (row: RequiredAction) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.requiredAction(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Action
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={() => {
                flushSync(() => {
                  setSelectedRequiredAction(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Action
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions, deleteDisclosure]
    );

    return (
      <>
        <Table<RequiredAction>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "quality") && (
              <New
                label="Required Action"
                to={`${path.to.newRequiredAction}?${params.toString()}`}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Required Actions"
        />
        {deleteDisclosure.isOpen && selectedRequiredAction && (
          <ConfirmDelete
            action={path.to.deleteRequiredAction(selectedRequiredAction.id)}
            isOpen
            onCancel={() => {
              setSelectedRequiredAction(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedRequiredAction(null);
              deleteDisclosure.onClose();
            }}
            name={selectedRequiredAction.name ?? "required action"}
            text="Are you sure you want to delete this required action?"
          />
        )}
      </>
    );
  }
);

RequiredActionsTable.displayName = "RequiredActionsTable";
export default RequiredActionsTable;
