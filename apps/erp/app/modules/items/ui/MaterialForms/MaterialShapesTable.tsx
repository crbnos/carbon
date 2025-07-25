import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCircleCheck,
  LuCode,
  LuPencil,
  LuTrash,
} from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { Form } from "../../types";

type MaterialShapesTableProps = {
  data: Form[];
  count: number;
};

const MaterialShapesTable = memo(
  ({ data, count }: MaterialShapesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const rows = useMemo(() => data, [data]);
    const customColumns = useCustomColumns<Form>("materialForm");

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) =>
            row.original.companyId === null ? (
              <Enumerable value={row.original.name} />
            ) : (
              <Hyperlink
                to={`${path.to.materialForm(
                  row.original.id
                )}?${params.toString()}`}
              >
                <Enumerable value={row.original.name} />
              </Hyperlink>
            ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          accessorKey: "code",
          header: "Code",
          cell: ({ row }) => row.original.code,
          meta: {
            icon: <LuCode />,
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
                  `${path.to.materialForm(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Material Shape
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "parts") || row.companyId === null
              }
              destructive
              onClick={() => {
                navigate(
                  `${path.to.deleteMaterialForm(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Material Shape
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
              label="Material Shape"
              to={`${path.to.newMaterialForm}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Material Shapes"
      />
    );
  }
);

MaterialShapesTable.displayName = "MaterialShapesTable";
export default MaterialShapesTable;
