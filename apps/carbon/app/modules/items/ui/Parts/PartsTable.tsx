import { Badge, Checkbox, Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Part } from "~/modules/items";
import {
  MethodIcon,
  TrackingTypeIcon,
  itemReplenishmentSystems,
  itemTrackingTypes,
  methodType,
} from "~/modules/items";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type PartsTableProps = {
  data: Part[];
  itemPostingGroups: ListItem[];
  count: number;
};

const PartsTable = memo(
  ({ data, count, itemPostingGroups }: PartsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();

    const [people] = usePeople();
    const customColumns = useCustomColumns<Part>("part");

    const columns = useMemo<ColumnDef<Part>[]>(() => {
      const defaultColumns: ColumnDef<Part>[] = [
        {
          accessorKey: "id",
          header: "Part ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.partDetails(row.original.itemId!)}>
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
          accessorKey: "itemTrackingType",
          header: "Tracking",
          cell: (item) => (
            <Badge variant="secondary">
              <TrackingTypeIcon
                type={item.getValue<string>()}
                className="mr-2"
              />
              <span>{item.getValue<string>()}</span>
            </Badge>
          ),
          meta: {
            filter: {
              type: "static",
              options: itemTrackingTypes.map((type) => ({
                value: type,
                label: (
                  <Badge variant="secondary">
                    <TrackingTypeIcon type={type} className="mr-2" />
                    <span>{type}</span>
                  </Badge>
                ),
              })),
            },
          },
        },

        {
          accessorKey: "defaultMethodType",
          header: "Default Method",
          cell: (item) => (
            <Badge variant="secondary">
              <MethodIcon type={item.getValue<string>()} className="mr-2" />
              <span>{item.getValue<string>()}</span>
            </Badge>
          ),
          meta: {
            filter: {
              type: "static",
              options: methodType.map((value) => ({
                value,
                label: (
                  <Badge variant="secondary">
                    <MethodIcon type={value} className="mr-2" />
                    <span>{value}</span>
                  </Badge>
                ),
              })),
            },
          },
        },
        {
          accessorKey: "replenishmentSystem",
          header: "Replenishment",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: itemReplenishmentSystems.map((type) => ({
                value: type,
                label: <Enumerable value={type} />,
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
    }, [customColumns, people]);

    const renderContextMenu = useMemo(() => {
      // eslint-disable-next-line react/display-name
      return (row: Part) => (
        <MenuItem onClick={() => navigate(path.to.part(row.itemId!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit Part
        </MenuItem>
      );
    }, [navigate]);

    return (
      <>
        <Table<Part>
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
              <New label="Part" to={path.to.newPart} />
            )
          }
          renderContextMenu={renderContextMenu}
          withColumnOrdering
        />
      </>
    );
  }
);

PartsTable.displayName = "PartTable";

export default PartsTable;
