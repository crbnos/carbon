import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCircleCheck,
  LuGlassWater,
  LuPencil,
  LuShapes,
  LuTag,
  LuTrash,
} from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useShape } from "~/components/Form/Shape";
import { useSubstance } from "~/components/Form/Substance";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { MaterialType } from "../../types";

type MaterialTypesTableProps = {
  data: MaterialType[];
  count: number;
};

const MaterialTypesTable = memo(({ data, count }: MaterialTypesTableProps) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const substances = useSubstance();
  const shapes = useShape();

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
        accessorKey: "formName",
        header: "Shape",
        cell: ({ row }) => <Enumerable value={row.original.formName} />,
        meta: {
          icon: <LuShapes />,
          filter: {
            type: "static",
            options: shapes.map((shape) => ({
              label: <Enumerable value={shape.label} />,
              value: shape.label,
            })),
          },
        },
      },
      {
        accessorKey: "name",
        header: "Type",
        cell: ({ row }) =>
          row.original.companyId === null ? (
            row.original.name
          ) : (
            <Hyperlink
              to={`${path.to.materialType(
                row.original.id!
              )}?${params.toString()}`}
            >
              {row.original.name}
            </Hyperlink>
          ),
        meta: {
          icon: <LuTag />,
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
  }, [params, substances, shapes]);

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
                `${path.to.materialType(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Material Type
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("delete", "parts") || row.companyId === null
            }
            destructive
            onClick={() => {
              navigate(
                `${path.to.deleteMaterialType(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Material Type
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
            label="Material Type"
            to={`${path.to.newMaterialType}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title="Material Types"
    />
  );
});

MaterialTypesTable.displayName = "MaterialTypesTable";
export default MaterialTypesTable;