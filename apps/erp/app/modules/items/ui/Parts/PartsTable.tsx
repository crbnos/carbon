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
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
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
  LuGitPullRequestArrow,
  LuGroup,
  LuLoaderCircle,
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
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import {
  itemReplenishmentSystems,
  itemTrackingTypes
} from "../../items.models";
import type { Part } from "../../types";

type PartsTableProps = {
  data: Part[];
  tags: { name: string }[];
  count: number;
};

const PartsTable = memo(({ data, tags, count }: PartsTableProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();

  const translateReplenishment = useCallback(
    (v: string) =>
      v === "Buy" ? t`Buy` : v === "Make" ? t`Make` : t`Buy and Make`,
    [t]
  );
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

  const deleteItemModal = useDisclosure();
  const [selectedItem, setSelectedItem] = useState<Part | null>(null);

  const [people] = usePeople();
  const itemPostingGroups = useItemPostingGroups();
  const customColumns = useCustomColumns<Part>("part");

  const columns = useMemo<ColumnDef<Part>[]>(() => {
    const defaultColumns: ColumnDef<Part>[] = [
      {
        accessorKey: "id",
        header: t`Part ID`,
        cell: ({ row }) => (
          <HStack className="py-1 min-w-[200px] truncate" spacing={2}>
            <ItemThumbnail
              size="md"
              thumbnailPath={row.original.thumbnailPath}
              type="Part"
            />
            <Hyperlink to={path.to.partDetails(row.original.id!)}>
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
          const label = itemPostingGroup?.label;
          return label ? <Badge variant="secondary">{label}</Badge> : null;
        },
        meta: {
          filter: {
            type: "static",
            options: itemPostingGroups.map((group) => ({
              value: group.value,
              label: <Badge variant="secondary">{group.label}</Badge>
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
            <TrackingTypeIcon type={item.getValue<string>()} className="mr-2" />
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
        accessorKey: "replenishmentSystem",
        header: t`Replenishment`,
        cell: (item) => (
          <Badge variant="secondary">
            <ReplenishmentSystemIcon
              type={item.getValue<string>()}
              className="mr-2"
            />
            <span>{translateReplenishment(item.getValue<string>())}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: itemReplenishmentSystems.map((type) => ({
              value: type,
              label: (
                <Badge variant="secondary">
                  <ReplenishmentSystemIcon type={type} className="mr-2" />
                  <span>{translateReplenishment(type)}</span>
                </Badge>
              )
            }))
          },
          icon: <LuLoaderCircle />
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
            options: tags?.map((tag) => ({
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
    translateReplenishment,
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
                      <span>{group.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trans>Replenishment</Trans>
              </DropdownMenuSubTrigger>
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
                      <DropdownMenuIcon
                        icon={<ReplenishmentSystemIcon type={system} />}
                      />
                      <span>{translateReplenishment(system)}</span>
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
      translateReplenishment,
      translateTrackingType
    ]
  );

  const renderContextMenu = useMemo(() => {
    return (row: Part) => {
      const revisions =
        (row.revisions as {
          id: string;
          revision: number;
        }[]) ?? [];
      return (
        <>
          <MenuItem onClick={() => navigate(path.to.part(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Part</Trans>
          </MenuItem>
          {revisions && revisions.length > 1 && (
            <MenuSub>
              <MenuSubTrigger>
                <MenuIcon icon={<LuGitPullRequestArrow />} />
                <Trans>Versions</Trans>
              </MenuSubTrigger>
              <MenuSubContent>
                {revisions.map((revision) => (
                  <MenuItem
                    key={revision.id}
                    onClick={() => navigate(path.to.part(revision.id))}
                  >
                    <MenuIcon icon={<LuTag />} />
                    {t`Revision ${revision.revision}`}
                  </MenuItem>
                ))}
              </MenuSubContent>
            </MenuSub>
          )}
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "parts")}
            onClick={() => {
              setSelectedItem(row);
              deleteItemModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Part</Trans>
          </MenuItem>
        </>
      );
    };
  }, [deleteItemModal, navigate, permissions, t]);

  return (
    <>
      <Table<Part>
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
            table: "part" as const,
            label: t`Parts`
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
              <New label={t`Part`} to={path.to.newPart} />
            </div>
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title={t`Parts`}
        table="part"
        withSavedView
        withSelectableRows
      />
      {selectedItem && selectedItem.id && (
        <ConfirmDelete
          action={path.to.deleteItem(selectedItem.id!)}
          isOpen={deleteItemModal.isOpen}
          name={selectedItem.readableIdWithRevision!}
          text={t`Are you sure you want to delete ${selectedItem.readableIdWithRevision}? This cannot be undone.`}
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

PartsTable.displayName = "PartTable";

export default PartsTable;
