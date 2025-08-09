import { Badge, Copy, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCircleCheck,
  LuDessert,
  LuKeySquare,
  LuPencil,
  LuShapes,
  LuTrash,
} from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useSubstance } from "~/components/Form/Substance";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { MaterialDimension } from "../../types";

type MaterialDimensionsTableProps = {
  data: MaterialDimension[];
  count: number;
};

const MaterialDimensionsTable = memo(
  ({ data, count }: MaterialDimensionsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const substances = useSubstance();

    const rows = useMemo(() => data, [data]);

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "formName",
          header: "Shape",
          cell: ({ row }) => <Enumerable value={row.original.formName} />,
          meta: {
            icon: <LuShapes />,
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
          header: "Dimension",
          cell: ({ row }) =>
            row.original.companyId === null ? (
              row.original.name
            ) : (
              <Hyperlink
                to={`${path.to.materialDimension(
                  row.original.id!
                )}?${params.toString()}`}
              >
                {row.original.name}
              </Hyperlink>
            ),
          meta: {
            icon: <LuDessert />,
          },
        },
        {
          accessorKey: "id",
          header: "ID",
          cell: ({ row }) => (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{row.original.id}</span>
              <Copy text={row.original.id!} />
            </div>
          ),
          meta: {
            icon: <LuKeySquare />,
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
                  `${path.to.materialDimension(row.id!)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Material Dimension
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "parts") || row.companyId === null
              }
              destructive
              onClick={() => {
                navigate(
                  `${path.to.deleteMaterialDimension(
                    row.id!
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Material Dimension
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
              label="Material Dimension"
              to={`${path.to.newMaterialDimension}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Material Dimensions"
      />
    );
  }
);

MaterialDimensionsTable.displayName = "MaterialDimensionsTable";
export default MaterialDimensionsTable;
