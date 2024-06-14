import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Form } from "~/modules/items";
import { path } from "~/utils/path";

type MaterialFormsTableProps = {
  data: Form[];
  count: number;
};

const MaterialFormsTable = memo(({ data, count }: MaterialFormsTableProps) => {
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
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.materialForm(row.original.id)}?${params.toString()}`}
          >
            {row.original.name}
          </Hyperlink>
        ),
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
              navigate(`${path.to.materialForm(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Material Form
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("delete", "parts") || row.companyId === null
            }
            onClick={() => {
              navigate(
                `${path.to.deleteMaterialForm(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Material Form
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
            label="Material Form"
            to={`${path.to.newMaterialForm}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
    />
  );
});

MaterialFormsTable.displayName = "MaterialFormsTable";
export default MaterialFormsTable;
