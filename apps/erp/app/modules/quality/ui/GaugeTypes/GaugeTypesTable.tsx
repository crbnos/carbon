import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuCircleGauge, LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { GaugeType } from "../../types";

type GaugeTypesTableProps = {
  data: GaugeType[];
  count: number;
};

const GaugeTypesTable = memo(({ data, count }: GaugeTypesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const customColumns = useCustomColumns<GaugeType>("gaugeType");

  const columns = useMemo<ColumnDef<GaugeType>[]>(() => {
    const defaultColumns: ColumnDef<GaugeType>[] = [
      {
        accessorKey: "name",
        header: "Gauge Type",
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>
            <Enumerable value={row.original.name} />
          </Hyperlink>
        ),
        meta: {
          icon: <LuCircleGauge />,
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns]);

  const renderContextMenu = useCallback(
    (row: GaugeType) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.gaugeType(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Type
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "sales")}
            onClick={() => {
              navigate(
                `${path.to.deleteGaugeType(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Type
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<GaugeType>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "quality") && (
          <New
            label="Gauge Type"
            to={`${path.to.newGaugeType}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title="Gauge Types"
    />
  );
});

GaugeTypesTable.displayName = "GaugeTypesTable";
export default GaugeTypesTable;
