import { Checkbox, Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Material } from "~/modules/items";
import { itemInventoryTypes } from "~/modules/items";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type MaterialsTableProps = {
  data: Material[];
  itemGroups: ListItem[];
  count: number;
};

const MaterialsTable = memo(
  ({ data, count, itemGroups }: MaterialsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [params] = useUrlParams();
    const [people] = usePeople();
    const customColumns = useCustomColumns<Material>("material");

    const columns = useMemo<ColumnDef<Material>[]>(() => {
      const defaultColumns: ColumnDef<Material>[] = [
        {
          accessorKey: "id",
          header: "Material ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.materialDetails(row.original.itemId!)}>
              {row.original.id}
            </Hyperlink>
          ),
        },
        {
          accessorKey: "name",
          header: "Name",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "description",
          header: "Description",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "materialSubstance",
          header: "Substance",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "fetcher",
              endpoint: path.to.api.materialSubstances,
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  value: name,
                  label: <Enumerable value={name} />,
                })) ?? [],
            },
          },
        },
        {
          accessorKey: "materialForm",
          header: "Form",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "fetcher",
              endpoint: path.to.api.materialForms,
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  value: name,
                  label: <Enumerable value={name} />,
                })) ?? [],
            },
          },
        },
        {
          accessorKey: "finish",
          header: "Finish",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "grade",
          header: "Grade",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "dimensions",
          header: "Dimensions",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "itemInventoryType",
          header: "Inventory",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: itemInventoryTypes.map((type) => ({
                value: type,
                label: <Enumerable value={type} />,
              })),
            },
          },
        },
        {
          accessorKey: "itemGroup",
          header: "Posting Group",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: itemGroups.map(({ name }) => ({
                value: name,
                label: <Enumerable value={name} />,
              })),
            },
          },
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ],
            },
            pluralHeader: "Active Statuses",
          },
        },
        {
          id: "assignee",
          header: "Assignee",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          id: "createdBy",
          header: "Created By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
        {
          id: "updatedBy",
          header: "Updated By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          accessorKey: "updatedAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
      ];
      return [...defaultColumns, ...customColumns];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    const renderContextMenu = useMemo(() => {
      // eslint-disable-next-line react/display-name
      return (row: Material) => (
        <MenuItem onClick={() => navigate(path.to.material(row.itemId!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit Material
        </MenuItem>
      );
    }, [navigate]);

    return (
      <>
        <Table<Material>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["id"],
          }}
          defaultColumnVisibility={{
            description: false,
            active: false,
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false,
          }}
          primaryAction={
            permissions.can("create", "parts") && (
              <New label="Material" to={path.to.newMaterial} />
            )
          }
          renderContextMenu={renderContextMenu}
          withColumnOrdering
        />
      </>
    );
  }
);

MaterialsTable.displayName = "MaterialTable";

export default MaterialsTable;
