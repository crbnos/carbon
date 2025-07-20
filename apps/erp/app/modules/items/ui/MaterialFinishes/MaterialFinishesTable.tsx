import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCircleCheck,
  LuDessert,
  LuGlassWater,
  LuPencil,
  LuTrash,
} from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useSubstance } from "~/components/Form/Substance";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { MaterialFinish } from "../../types";

type MaterialFinishesTableProps = {
  data: MaterialFinish[];
  count: number;
};

const MaterialFinishesTable = memo(
  ({ data, count }: MaterialFinishesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const substances = useSubstance();

    const rows = useMemo(() => data, [data]);

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "substanceName",
          header: "Substance",
          cell: ({ row }) => <Enumerable value={row.original.substanceName} />,
          meta: {
            icon: <LuGlassWater />,
            filter: {
              type: "static",
              options: substances.map((substance) => ({
                label: <Enumerable value={substance.label} />,
                value: substance.label,
              })),
            },
          },
        },
        {
          accessorKey: "name",
          header: "Finish",
          cell: ({ row }) =>
            row.original.companyId === null ? (
              <Enumerable value={row.original.name} />
            ) : (
              <Hyperlink
                to={`${path.to.materialFinish(
                  row.original.id!
                )}?${params.toString()}`}
              >
                <Enumerable value={row.original.name} />
              </Hyperlink>
            ),
          meta: {
            icon: <LuDessert />,
          },
        },

        {
          accessorKey: "companyId",
          header: "Standard",
          cell: ({ row }) => {
            return row.original.companyId === null ? (
              <Badge variant="outline">Standard</Badge>
            ) : (
              <Badge variant="blue">Custom</Badge>
            );
          },
          meta: {
            icon: <LuCircleCheck />,
          },
        },
      ];
      return [...defaultColumns];
    }, [params, substances]);

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
                  `${path.to.materialFinish(row.id!)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Material Finish
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "parts") || row.companyId === null
              }
              destructive
              onClick={() => {
                navigate(
                  `${path.to.deleteMaterialFinish(
                    row.id!
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Material Finish
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
              label="Material Finish"
              to={`${path.to.newMaterialFinish}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Material Finishes"
      />
    );
  }
);

MaterialFinishesTable.displayName = "MaterialFinishesTable";
export default MaterialFinishesTable;
