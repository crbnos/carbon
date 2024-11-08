import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBookMarked, LuGlobe, LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Substance } from "~/modules/items";
import { path } from "~/utils/path";

type MaterialSubstancesTableProps = {
  data: Substance[];
  count: number;
};

const MaterialSubstancesTable = memo(
  ({ data, count }: MaterialSubstancesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const rows = useMemo(() => data, [data]);
    const customColumns = useCustomColumns<Substance>("materialSubstance");

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) =>
            row.original.companyId === null ? (
              row.original.name
            ) : (
              <Hyperlink
                to={`${path.to.materialSubstance(
                  row.original.id
                )}?${params.toString()}`}
              >
                {row.original.name}
              </Hyperlink>
            ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          header: "Type",
          cell: ({ row }) =>
            row.original.companyId === null ? (
              <Badge className="border-dashed" variant="outline">
                Global
              </Badge>
            ) : (
              <Badge>Company</Badge>
            ),
          meta: {
            icon: <LuGlobe />,
          },
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [params, customColumns]);

    const renderContextMenu = useCallback(
      (row: (typeof rows)[number]) => {
        return (
          <>
            <MenuItem
              disabled={
                !permissions.can("update", "parts") || row.companyId === null
              }
              onClick={() => {
                navigate(
                  `${path.to.materialSubstance(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Substance
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "parts") || row.companyId === null
              }
              onClick={() => {
                navigate(
                  `${path.to.deleteMaterialSubstance(
                    row.id
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Substance
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<(typeof rows)[number]>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label="Material Substance"
              to={`${path.to.newMaterialSubstance}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
      />
    );
  }
);

MaterialSubstancesTable.displayName = "MaterialSubstancesTable";
export default MaterialSubstancesTable;
