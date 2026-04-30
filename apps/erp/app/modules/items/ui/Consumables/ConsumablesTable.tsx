import {
  Badge,
  Button,
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
  VStack
} from "@carbon/react";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuAlignJustify,
  LuBookMarked,
  LuCalendar,
  LuCheck,
  LuGroup,
  LuPencil,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetArrow } from "react-icons/tb";
import { Link, useFetcher, useNavigate } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  MethodIcon,
  New,
  Table,
  TrackingTypeIcon
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { itemTrackingTypes } from "../../items.models";
import type { Consumable } from "../../types";

type ConsumablesTableProps = {
  data: Consumable[];
  tags: { name: string }[];
  count: number;
};

const ConsumablesTable = memo(
  ({ data, count, tags }: ConsumablesTableProps) => {
    const { t } = useLingui();
    const translateMethodType = useCallback(
      (v: string) =>
        v === "Purchase to Order"
          ? t`Purchase to Order`
          : v === "Pull from Inventory"
            ? t`Pull from Inventory`
            : t`Make to Order`,
      [t]
    );
    const translateTrackingType = useCallback(
      (v: string) =>
        v === "Inventory"
          ? t`Inventory`
          : v === "Non-Inventory"
            ? t`Non-Inventory`
            : v === "Serial"
              ? t`Serial`
              : t`Batch`,
      [t]
    );
    const navigate = useNavigate();
    const permissions = usePermissions();
    const { formatDate } = useDateFormatter();

    const deleteItemModal = useDisclosure();
    const [selectedItem, setSelectedItem] = useState<Consumable | null>(null);

    const [people] = usePeople();
    const itemPostingGroups = useItemPostingGroups();
    const customColumns = useCustomColumns<Consumable>("consumable");

    const columns = useMemo<ColumnDef<Consumable>[]>(() => {
      const defaultColumns: ColumnDef<Consumable>[] = [
        {
          accessorKey: "id",
          header: t`Consumable ID`,
          cell: ({ row }) => (
            <HStack className="py-1 min-w-[200px] truncate">
              <ItemThumbnail
                thumbnailPath={row.original.thumbnailPath}
                type="Consumable"
              />
              <Hyperlink to={path.to.consumableDetails(row.original.id!)}>
                <VStack spacing={0}>
                  {row.original.readableIdWithRevision}
                  <div className="w-full truncate text-muted-foreground text-xs">
                    {row.original.name}
                  </div>
                </VStack>
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: (item) => (
            <div className="max-w-[320px] truncate">
              {item.getValue<string>()}
            </div>
          ),
          meta: {
            icon: <LuAlignJustify />
          }
        },
        {
          accessorKey: "itemPostingGroupId",
          header: t`Item Group`,
          cell: (item) => {
            const itemPostingGroupId = item.getValue<string>();
            const itemPostingGroup = itemPostingGroups.find(
              (group) => group.value === itemPostingGroupId
            );
            return <Enumerable value={itemPostingGroup?.label ?? null} />;
          },
          meta: {
            filter: {
              type: "static",
              options: itemPostingGroups.map((group) => ({
                value: group.value,
                label: <Enumerable value={group.label} />
              }))
            },
            icon: <LuGroup />
          }
        },
        {
          accessorKey: "itemTrackingType",
          header: t`Tracking`,
          cell: (item) => (
            <Badge variant="secondary">
              <TrackingTypeIcon
                type={item.getValue<string>()}
                className="mr-2"
              />
              <span>{translateTrackingType(item.getValue<string>())}</span>
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
                    <span>{translateTrackingType(type)}</span>
                  </Badge>
                )
              }))
            },
            icon: <TbTargetArrow />
          }
        },
        {
          accessorKey: "defaultMethodType",
          header: t`Default Method`,
          cell: (item) => (
            <Badge variant="secondary">
              <MethodIcon type={item.getValue<string>()} className="mr-2" />
              <span>{translateMethodType(item.getValue<string>())}</span>
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
                    <span>{translateMethodType(value)}</span>
                  </Badge>
                )
              }))
            },
            icon: <RxCodesandboxLogo />
          }
        },
        {
          accessorKey: "tags",
          header: t`Tags`,
          cell: ({ row }) => (
            <HStack spacing={0} className="gap-1">
              {row.original.tags?.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </HStack>
          ),
          meta: {
            filter: {
              type: "static",
              options: tags.map((tag) => ({
                value: tag.name,
                label: <Badge variant="secondary">{tag.name}</Badge>
              })),
              isArray: true
            },
            icon: <LuTag />
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: t`Active` },
                { value: "false", label: t`Inactive` }
              ]
            },
            pluralHeader: t`Active Statuses`,
            icon: <LuCheck />
          }
        },
        // {
        //   id: "assignee",
        //   header: t`Assignee`,
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
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            },
            icon: <LuUser />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "updatedBy",
          header: t`Updated By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            },
            icon: <LuUser />
          }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [
      tags,
      people,
      customColumns,
      itemPostingGroups,
      t,
      translateMethodType,
      translateTrackingType
    ]);

    const fetcher = useFetcher<typeof action>();
    useEffect(() => {
      if (fetcher.data?.error) {
        toast.error(fetcher.data.error.message);
      }
    }, [fetcher.data]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const onBulkUpdate = useCallback(
      (
        selectedRows: typeof data,
        field:
          | "replenishmentSystem"
          | "defaultMethodType"
          | "itemTrackingType"
          | "itemPostingGroupId",
        value: string
      ) => {
        const formData = new FormData();
        selectedRows.forEach((row) => {
          if (row.id) formData.append("items", row.id);
        });
        formData.append("field", field);
        formData.append("value", value);
        fetcher.submit(formData, {
          method: "post",
          action: path.to.bulkUpdateItems
        });
      },

      []
    );

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        return (
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>
              <Trans>Update</Trans>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Trans>Item Group</Trans>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {itemPostingGroups.map((group) => (
                      <DropdownMenuItem
                        key={group.value}
                        onClick={() =>
                          onBulkUpdate(
                            selectedRows,
                            "itemPostingGroupId",
                            group.value
                          )
                        }
                      >
                        <Enumerable value={group.label} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Trans>Default Method Type</Trans>
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
                        <span>{translateMethodType(type)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Trans>Tracking Type</Trans>
                </DropdownMenuSubTrigger>
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
                        <span>{translateTrackingType(type)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        );
      },
      [
        onBulkUpdate,
        itemPostingGroups,
        translateMethodType,
        translateTrackingType
      ]
    );

    const renderContextMenu = useMemo(() => {
      return (row: Consumable) => (
        <>
          <MenuItem onClick={() => navigate(path.to.consumable(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            Edit Consumable
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "parts")}
            destructive
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
            left: ["id"]
          }}
          defaultColumnVisibility={{
            description: false,
            active: false,
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false
          }}
          importCSV={[
            {
              table: "consumable",
              label: t`Consumables`
            }
          ]}
          primaryAction={
            permissions.can("create", "parts") && (
              <div className="flex items-center gap-2">
                <Button variant="secondary" leftIcon={<LuGroup />} asChild>
                  <Link to={path.to.itemPostingGroups}>
                    <Trans>Item Groups</Trans>
                  </Link>
                </Button>
                <New label={t`Consumable`} to={path.to.newConsumable} />
              </div>
            )
          }
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          title={t`Consumables`}
          table="consumable"
          withSavedView
          withSelectableRows
        />
        {selectedItem && selectedItem.id && (
          <ConfirmDelete
            action={path.to.deleteItem(selectedItem.id!)}
            isOpen={deleteItemModal.isOpen}
            name={selectedItem.readableIdWithRevision!}
            text={t`Are you sure you want to delete ${selectedItem.readableIdWithRevision!}? This cannot be undone.`}
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
