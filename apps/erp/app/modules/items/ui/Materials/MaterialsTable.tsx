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
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  toast,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useNavigate } from "@remix-run/react";
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
  LuPaintBucket,
  LuPencil,
  LuPuzzle,
  LuShapes,
  LuStar,
  LuTag,
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
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { usePermissions } from "~/hooks";
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
  const navigate = useNavigate();
  const permissions = usePermissions();

  const deleteItemModal = useDisclosure();
  const [selectedItem, setSelectedItem] = useState<Material | null>(null);

  const [people] = usePeople();
  const customColumns = useCustomColumns<Material>("material");

  const filters = useFilters();
  const materialSubstanceId = filters.getFilter("materialSubstanceId")?.[0];
  const materialFormId = filters.getFilter("materialFormId")?.[0];

  const columns = useMemo<ColumnDef<Material>[]>(() => {
    const defaultColumns: ColumnDef<Material>[] = [
      {
        accessorKey: "id",
        header: "Material ID",
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
          icon: <LuBookMarked />,
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
        accessorKey: "materialSubstanceId",
        header: "Substance",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialSubstances,
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ id, name }) => ({
                value: id,
                label: <Enumerable value={name} />,
              })) ?? [],
          },
          icon: <LuGlassWater />,
        },
      },
      {
        accessorKey: "materialFormId",
        header: "Form",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialForms,
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ id, name }) => ({
                value: id,
                label: <Enumerable value={name} />,
              })) ?? [],
          },
          icon: <LuShapes />,
        },
      },
      {
        accessorKey: "finish",
        header: "Finish",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuPaintBucket />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialFinishes(materialSubstanceId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: name,
              })) ?? [],
          },
        },
      },
      {
        accessorKey: "grade",
        header: "Grade",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuStar />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialGrades(materialSubstanceId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: name,
              })) ?? [],
          },
        },
      },
      {
        accessorKey: "dimensions",
        header: "Dimensions",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuExpand />,
          filter: {
            type: "fetcher",
            endpoint: path.to.api.materialDimensions(materialFormId),
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: name,
              })) ?? [],
          },
        },
      },
      {
        accessorKey: "materialType",
        header: "Type",
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
                label: name,
              })) ?? [],
          },
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
        accessorKey: "tags",
        header: "Tags",
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
              label: <Badge variant="secondary">{tag.name}</Badge>,
            })),
            isArray: true,
          },
          icon: <LuTag />,
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
        header: "Updated At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [tags, people, customColumns, materialSubstanceId, materialFormId]);

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const onBulkUpdate = useCallback(
    (
      selectedRows: typeof data,
      field:
        | "materialFormId"
        | "materialSubstanceId"
        | "defaultMethodType"
        | "itemTrackingType",
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
        action: path.to.bulkUpdateItems,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [materialSubstanceId, materialFormId]
  );

  const renderActions = useCallback(
    (selectedRows: typeof data) => {
      return (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>Update</DropdownMenuLabel>
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
              <DropdownMenuSubTrigger>Tracking Type</DropdownMenuSubTrigger>
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
            Edit Material
          </MenuItem>
          {revisions && revisions.length > 1 && (
            <MenuSub>
              <MenuSubTrigger>
                <MenuIcon icon={<LuGitPullRequestArrow />} />
                Versions
              </MenuSubTrigger>
              <MenuSubContent>
                {revisions.map((revision) => (
                  <MenuItem
                    key={revision.id}
                    onClick={() => navigate(path.to.material(revision.id))}
                  >
                    <MenuIcon icon={<LuTag />} />
                    Revision {revision.revision}
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
            Delete Material
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
            table: "material" as const,
            label: "Materials",
          },
        ]}
        primaryAction={
          permissions.can("create", "parts") && (
            <New label="Material" to={path.to.newMaterial} />
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title="Materials"
        table="material"
        withSavedView
        withSelectableRows
      />
      {selectedItem && selectedItem.id && (
        <ConfirmDelete
          action={path.to.deleteItem(selectedItem.id!)}
          isOpen={deleteItemModal.isOpen}
          name={selectedItem.readableIdWithRevision!}
          text={`Are you sure you want to delete ${selectedItem.readableIdWithRevision!}? This cannot be undone.`}
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
