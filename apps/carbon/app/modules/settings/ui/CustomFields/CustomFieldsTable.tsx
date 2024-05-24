import { Button, Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { Link, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BiAddToQueue } from "react-icons/bi";
import { BsListUl } from "react-icons/bs";
import { Hyperlink, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { modulesType, type CustomFieldsTableType } from "~/modules/settings";
import { path } from "~/utils/path";

type CustomFieldsTableProps = {
  data: CustomFieldsTableType[];
  count: number;
};

const CustomFieldsTable = memo(({ data, count }: CustomFieldsTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<CustomFieldsTableType>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Table",
        cell: ({ row }) => (
          <Hyperlink to={row.original.table!}>{row.original.name}</Hyperlink>
        ),
      },
      {
        accessorKey: "module",
        header: "Module",
        cell: ({ row }) => <Enumerable value={row.original.module} />,
        meta: {
          filter: {
            type: "static",
            options: modulesType.map((m) => ({
              label: <Enumerable value={m} />,
              value: m,
            })),
          },
        },
      },
      {
        header: "Fields",
        cell: ({ row }) => (
          <Button variant="secondary" asChild>
            <Link
              to={`${path.to.customFieldList(
                row.original.table!
              )}?${params?.toString()}`}
            >
              {Array.isArray(row.original.fields)
                ? row.original.fields?.length ?? 0
                : 0}{" "}
              Fields
            </Link>
          </Button>
        ),
      },
    ];
  }, [params]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(
                `${path.to.newCustomField(row.table!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<BiAddToQueue />} />
            New Field
          </MenuItem>
          <MenuItem
            onClick={() => {
              navigate(
                `${path.to.customFieldList(row.table!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<BsListUl />} />
            View Custom Fields
          </MenuItem>
        </>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, params, permissions]
  );

  return (
    <>
      <Table<CustomFieldsTableType>
        data={data}
        columns={columns}
        count={count ?? 0}
        renderContextMenu={renderContextMenu}
      />
    </>
  );
});

CustomFieldsTable.displayName = "CustomFieldsTable";
export default CustomFieldsTable;
