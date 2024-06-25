import { Badge, Checkbox, Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table,
} from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Fixture } from "~/modules/items";
import {
  MethodIcon,
  TrackingTypeIcon,
  itemReplenishmentSystems,
  itemTrackingTypes,
  methodType,
} from "~/modules/items";
import { useCustomers, usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type FixturesTableProps = {
  data: Fixture[];
  itemPostingGroups: ListItem[];
  count: number;
};

const FixturesTable = memo(
  ({ data, count, itemPostingGroups }: FixturesTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [params] = useUrlParams();
    const [customers] = useCustomers();
    const [people] = usePeople();
    const customColumns = useCustomColumns<Fixture>("fixture");

    const columns = useMemo<ColumnDef<Fixture>[]>(() => {
      const defaultColumns: ColumnDef<Fixture>[] = [
        {
          accessorKey: "id",
          header: "Fixture ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.fixtureDetails(row.original.itemId!)}>
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
          accessorKey: "customerId",
          header: "Customer",
          cell: (item) => (
            <CustomerAvatar customerId={item.getValue<string>()} />
          ),
          meta: {
            filter: {
              type: "static",
              options: customers.map((customer) => ({
                value: customer.id,
                label: customer.name,
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
      return (row: Fixture) => (
        <MenuItem onClick={() => navigate(path.to.fixture(row.itemId!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit Fixture
        </MenuItem>
      );
    }, [navigate]);

    return (
      <>
        <Table<Fixture>
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
              <New label="Fixture" to={path.to.newFixture} />
            )
          }
          renderContextMenu={renderContextMenu}
          withColumnOrdering
        />
      </>
    );
  }
);

FixturesTable.displayName = "FixtureTable";

export default FixturesTable;
