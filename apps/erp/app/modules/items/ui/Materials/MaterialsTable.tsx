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
  LuExpand,
  LuGitPullRequestArrow,
  LuGlassWater,
  LuGroup,
  LuPaintBucket,
  LuPencil,
  LuPuzzle,
  LuRuler,
  LuShapes,
  LuStar,
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
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ConfirmDelete } from "~/components/Modals";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { itemTrackingTypes } from "../../items.models";
import type { Material } from "../../types";

type MaterialsTableProps = {
  data: Material[];
  tags: { name: string }[];
  count: number;
};

const MaterialsTable = memo(({ data, tags, count }: MaterialsTableProps) => {
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
  const [selectedItem, setSelectedItem] = useState<Material | null>(null);

  const [people] = usePeople();
  const unitsOfMeasure = useUnitOfMeasure();
  const itemPostingGroups = useItemPostingGroups();
  const customColumns = useCustomColumns<Material>("material");

  const filters = useFilters();
  const materialSubstanceId = filters.getFilter("materialSubstanceId")?.[0];
  const materialFormId = filters.getFilter("materialFormId")?.[0];

  const columns = useMemo<ColumnDef<Material>[]>(() => {
    const defaultColumns: ColumnDef<Material>[] = [
      {
        accessorKey: "id",
        header: t`Material ID`,
        cell: ({ row }) => (
          <HStack className="py-1 min-w-[200px] truncate">
            <ItemThumbnail
              size="md"
              thumbnailPath={row.original.thumbnailPath}
              type="Material"
            />
            <Hyperlink to={path.to.material(row.original.id!)}>
              <VStack spacing={0}>
                {row.original.readableId}
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
        accessorKey: "materialSubstanceId",
        header: t`Substance`,
        cell: ({ row }) => (
          <Enumerable value={row.original.materialSubstance} />
        ),
        meta: {
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialSubstances,
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ id, name }) => ({
                value: id,
                label: <Enumerable value={name} />
              })) ?? []
          },
          icon: <LuGlassWater />
        }
      },
      {
        accessorKey: "materialFormId",
        header: t`Shape`,
        cell: ({ row }) => <Enumerable value={row.original.materialForm} />,
        meta: {
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialForms,
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ id, name }) => ({
                value: id,
                label: <Enumerable value={name} />
              })) ?? []
          },
          icon: <LuShapes />
        }
      },
      {
        accessorKey: "finish",
        header: t`Finish`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuPaintBucket />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialFinishes(materialSubstanceId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: name
              })) ?? []
          }
        }
      },
      {
        accessorKey: "grade",
        header: t`Grade`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuStar />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialGrades(materialSubstanceId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: name
              })) ?? []
          }
        }
      },
      {
        accessorKey: "dimensions",
        header: t`Dimension`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuExpand />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialDimensions(materialFormId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: name
              })) ?? []
          }
        }
      },
      {
        accessorKey: "materialType",
        header: t`Type`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuPuzzle />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialTypes(
              materialSubstanceId,
              materialFormId
            ),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ id, name }) => ({
                value: id,
                label: name
              })) ?? []
          }
        }
      },
      {
        accessorKey: "itemPostingGroupId",
        header: t`Item Group`,
        cell: (item) => {
          const itemPostingGroupId = item.row.original.itemPostingGroupId;
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
        accessorKey: "unitOfMeasureCode",
        header: t`Unit of Measure`,
        cell: ({ row }) => <Enumerable value={row.original.unitOfMeasure} />,
        meta: {
          filter: {
            type: "static",
            options: unitsOfMeasure.map((unit) => ({
              value: unit.value,
              label: <Enumerable value={unit.label} />
            }))
          },
          icon: <LuRuler />
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
            {(row.original.tags || []).map((tag) => (
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
    materialSubstanceId,
    materialFormId,
    itemPostingGroups,
    unitsOfMeasure,
    tags,
    people,
    customColumns,
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
        | "materialFormId"
        | "materialSubstanceId"
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

    [materialSubstanceId, materialFormId]
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
    return (row: Material) => {
      const revisions =
        (row.revisions as {
          id: string;
          revision: number;
        }[]) ?? [];
      return (
        <>
          <MenuItem onClick={() => navigate(path.to.material(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Material</Trans>
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
                    onClick={() => navigate(path.to.material(revision.id))}
                  >
                    <MenuIcon icon={<LuTag />} />
                    <Trans>Revision {revision.revision}</Trans>
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
            <Trans>Delete Material</Trans>
          </MenuItem>
        </>
      );
    };
  }, [deleteItemModal, navigate, permissions]);

  return (
    <>
      <Table<Material>
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
            table: "material" as const,
            label: t`Materials`
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
              <New label={t`Material`} to={path.to.newMaterial} />
            </div>
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title={t`Materials`}
        table="material"
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
});

MaterialsTable.displayName = "MaterialTable";

export default MaterialsTable;
