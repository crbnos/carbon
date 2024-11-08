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
import {
  LuAlignJustify,
  LuAlignLeft,
  LuBookMarked,
  LuCalendar,
  LuCheck,
  LuPencil,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetArrow } from "react-icons/tb";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  MethodIcon,
  New,
  Table,
  TrackingTypeIcon,
} from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Tool } from "~/modules/items";
import { itemTrackingTypes } from "~/modules/items";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type ToolsTableProps = {
  data: Tool[];
  itemPostingGroups: ListItem[];
  count: number;
};

const ToolsTable = memo(({ data, count }: ToolsTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();

  const deleteItemModal = useDisclosure();
  const [selectedItem, setSelectedItem] = useState<Tool | null>(null);

  const [people] = usePeople();
  const customColumns = useCustomColumns<Tool>("tool");

  const columns = useMemo<ColumnDef<Tool>[]>(() => {
    const defaultColumns: ColumnDef<Tool>[] = [
      {
        accessorKey: "id",
        header: "Tool ID",
        cell: ({ row }) => (
          <HStack className="py-1 min-w-[200px] truncate">
            <ItemThumbnail
              size="sm"
              thumbnailPath={row.original.thumbnailPath}
              type="Tool"
            />
            <Hyperlink to={path.to.toolDetails(row.original.itemId!)}>
              {row.original.id}
            </Hyperlink>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />,
        },
      },
      {
        accessorKey: "name",
        header: "Short Description",
        cell: (item) => (
          <div className="max-w-[320px] truncate">
            {item.getValue<string>()}
          </div>
        ),
        meta: {
          icon: <LuAlignLeft />,
        },
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: (item) => (
          <div className="max-w-[320px] truncate">
            {item.getValue<string>()}
          </div>
        ),
        meta: {
          icon: <LuAlignJustify />,
        },
      },
      {
        accessorKey: "itemTrackingType",
        header: "Tracking",
        cell: (item) => (
          <Badge variant="secondary">
            <TrackingTypeIcon type={item.getValue<string>()} className="mr-2" />
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
          icon: <TbTargetArrow />,
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
          icon: <RxCodesandboxLogo />,
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
          icon: <LuCheck />,
        },
      },
      // {
      //   id: "assignee",
      //   header: "Assignee",
      //   cell: ({ row }) => (
      //     <EmployeeAvatar employeeId={row.original.assignee} />
      //   ),
      //   meta: {
      //     filter: {
      //       type: "static",
      //       options: people.map((employee) => ({
      //         value: employee.id,
      //         label: employee.name,
      //       })),
      //     },
      //   },
      // },
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
          icon: <LuUser />,
        },
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
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
          icon: <LuUser />,
        },
      },
      {
        accessorKey: "updatedAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, people]);

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
              <DropdownMenuSubTrigger>
                Default Method Type
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {methodType
                    .filter((type) => type !== "Make")
                    .map((type) => (
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
    return (row: Tool) => (
      <>
        <MenuItem onClick={() => navigate(path.to.tool(row.itemId!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit Tool
        </MenuItem>
        <MenuItem
          disabled={!permissions.can("delete", "parts")}
          onClick={() => {
            setSelectedItem(row);
            deleteItemModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete Tool
        </MenuItem>
      </>
    );
  }, [deleteItemModal, navigate, permissions]);

  return (
    <>
      <Table<Tool>
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
            table: "tool",
            label: "Tools",
          },
        ]}
        primaryAction={
          permissions.can("create", "parts") && (
            <New label="Tool" to={path.to.newTool} />
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
});

ToolsTable.displayName = "ToolTable";

export default ToolsTable;
