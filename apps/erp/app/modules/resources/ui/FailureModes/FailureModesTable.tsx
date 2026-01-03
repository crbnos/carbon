import { MenuIcon, MenuItem } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuCircleAlert, LuPencil, LuShapes, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { maintenanceFailureModeType } from "../../resources.models";
import type { FailureMode } from "../../types";

type FailureModesTableProps = {
  data: FailureMode[];
  count: number;
};

const FailureModesTable = memo(({ data, count }: FailureModesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<FailureMode>[]>(() => {
    const defaultColumns: ColumnDef<FailureMode>[] = [
      {
        accessorKey: "name",
        header: "Failure Mode",
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: {
          icon: <LuCircleAlert />
        }
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => <Enumerable value={row.original.type} />,
        meta: {
          icon: <LuShapes />,
          filter: {
            type: "static",
            options: maintenanceFailureModeType.map((type) => ({
              label: <Enumerable value={type} />,
              value: type
            }))
          }
        }
      }
    ];
    return [...defaultColumns];
  }, []);

  const renderContextMenu = useCallback(
    (row: FailureMode) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.failureMode(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Failure Mode
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(
                `${path.to.deleteFailureMode(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Failure Mode
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<FailureMode>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "resources") && (
          <New
            label="Failure Mode"
            to={`${path.to.newFailureMode}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title="Failure Modes"
    />
  );
});

FailureModesTable.displayName = "FailureModesTable";
export default FailureModesTable;
