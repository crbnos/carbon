import {
  Badge,
  Checkbox,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  HStack,
  MenuIcon,
  MenuItem,
  toast,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  MethodIcon,
  New,
  Table,
  TrackingTypeIcon,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Fixture } from "~/modules/items";
import { itemReplenishmentSystems, itemTrackingTypes } from "~/modules/items";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
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

    const deleteItemModal = useDisclosure();
    const [selectedItem, setSelectedItem] = useState<Fixture | null>(null);

    const [customers] = useCustomers();
    const [people] = usePeople();
    const customColumns = useCustomColumns<Fixture>("fixture");

    const columns = useMemo<ColumnDef<Fixture>[]>(() => {
      const defaultColumns: ColumnDef<Fixture>[] = [
        {
          accessorKey: "id",
          header: "Fixture ID",
          cell: ({ row }) => (
            <HStack className="py-1 max-w-[200px] truncate">
              <Hyperlink to={path.to.fixtureDetails(row.original.itemId!)}>
                {row.original.id}
              </Hyperlink>
            </HStack>
          ),
        },
        {
          accessorKey: "name",
          header: "Short Description",
          cell: (item) => (
            <div className="max-w-[320px] truncate">
              {item.getValue<string>()}
            </div>
          ),
        },
        {
          accessorKey: "description",
          header: "Description",
          cell: (item) => (
            <div className="max-w-[320px] truncate">
              {item.getValue<string>()}
            </div>
          ),
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
    }, [customColumns, customers, people]);

    const fetcher = useFetcher<typeof action>();
    useEffect(() => {
      if (fetcher.data?.error) {
        toast.error(fetcher.data.error.message);
      }
    }, [fetcher.data]);
    const onBulkUpdate = useCallback(
      (
        selectedRows: typeof data,
        field: "replenishmentSystem" | "defaultMethodType" | "itemTrackingType",
        value: string
      ) => {
        const formData = new FormData();
        selectedRows.forEach((row) => {
          if (row.itemId) formData.append("items", row.itemId);
        });
        formData.append("field", field);
        formData.append("value", value);
        fetcher.submit(formData, {
          method: "post",
          action: path.to.bulkUpdateItems,
        });
      },
      [fetcher]
    );

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        return (
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>Bulk Update</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Replenishment</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {itemReplenishmentSystems.map((system) => (
                      <DropdownMenuItem
                        key={system}
                        onClick={() =>
                          onBulkUpdate(
                            selectedRows,
                            "replenishmentSystem",
                            system
                          )
                        }
                      >
                        <Enumerable value={system} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  Default Method Type
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {methodType.map((type) => (
                      <DropdownMenuItem
                        key={type}
                        onClick={() =>
                          onBulkUpdate(selectedRows, "defaultMethodType", type)
                        }
                      >
                        <DropdownMenuIcon icon={<MethodIcon type={type} />} />
                        <span>{type}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Inventory</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {itemTrackingTypes.map((type) => (
                      <DropdownMenuItem
                        key={type}
                        onClick={() =>
                          onBulkUpdate(selectedRows, "itemTrackingType", type)
                        }
                      >
                        <DropdownMenuIcon
                          icon={<TrackingTypeIcon type={type} />}
                        />
                        <span>{type}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        );
      },
      [onBulkUpdate]
    );

    const renderContextMenu = useMemo(() => {
      // eslint-disable-next-line react/display-name
      return (row: Fixture) => (
        <>
          <MenuItem onClick={() => navigate(path.to.fixture(row.itemId!))}>
            <MenuIcon icon={<LuPencil />} />
            Edit Fixture
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "parts")}
            onClick={() => {
              setSelectedItem(row);
              deleteItemModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Fixture
          </MenuItem>
        </>
      );
    }, [deleteItemModal, navigate, permissions]);

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
          importCSV={[
            {
              table: "fixture",
              label: "Fixtures",
            },
          ]}
          primaryAction={
            permissions.can("create", "parts") && (
              <New label="Fixture" to={path.to.newFixture} />
            )
          }
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          withSelectableRows
        />
        {selectedItem && selectedItem.id && (
          <ConfirmDelete
            action={path.to.deleteItem(selectedItem.itemId!)}
            isOpen={deleteItemModal.isOpen}
            name={selectedItem.id!}
            text={`Are you sure you want to delete ${selectedItem.id!}? This cannot be undone.`}
            onCancel={() => {
              deleteItemModal.onClose();
              setSelectedItem(null);
            }}
            onSubmit={() => {
              deleteItemModal.onClose();
              setSelectedItem(null);
            }}
          />
        )}
      </>
    );
  }
);

FixturesTable.displayName = "FixtureTable";

export default FixturesTable;
