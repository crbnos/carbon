import {
  Badge,
  Checkbox,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import {
  EmployeeAvatar,
  Hyperlink,
  MethodIcon,
  New,
  Table,
  TrackingTypeIcon,
} from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Consumable } from "~/modules/items";
import { itemTrackingTypes } from "~/modules/items";
import { methodType } from "~/modules/shared";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type ConsumablesTableProps = {
  data: Consumable[];
  itemPostingGroups: ListItem[];
  count: number;
};

const ConsumablesTable = memo(
  ({ data, count, itemPostingGroups }: ConsumablesTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();

    const deleteItemModal = useDisclosure();
    const [selectedItem, setSelectedItem] = useState<Consumable | null>(null);

    const [people] = usePeople();
    const customColumns = useCustomColumns<Consumable>("consumable");

    const columns = useMemo<ColumnDef<Consumable>[]>(() => {
      const defaultColumns: ColumnDef<Consumable>[] = [
        {
          accessorKey: "id",
          header: "Consumable ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.consumableDetails(row.original.itemId!)}>
              {row.original.id}
            </Hyperlink>
          ),
        },
        {
          accessorKey: "name",
          header: "Short Description",
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
      return (row: Consumable) => (
        <>
          <MenuItem onClick={() => navigate(path.to.consumable(row.itemId!))}>
            <MenuIcon icon={<LuPencil />} />
            Edit Consumable
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "parts")}
            onClick={() => {
              setSelectedItem(row);
              deleteItemModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Consumable
          </MenuItem>
        </>
      );
    }, [deleteItemModal, navigate, permissions]);

    return (
      <>
        <Table<Consumable>
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
              <New label="Consumable" to={path.to.newConsumable} />
            )
          }
          renderContextMenu={renderContextMenu}
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

ConsumablesTable.displayName = "ConsumableTable";

export default ConsumablesTable;
