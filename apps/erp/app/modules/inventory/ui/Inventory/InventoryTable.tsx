import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuBox,
  LuBoxes,
  LuCalculator,
  LuCheck,
  LuCircleCheck,
  LuCirclePlay,
  LuClock,
  LuExpand,
  LuGlassWater,
  LuLoaderCircle,
  LuMoveDown,
  LuMoveUp,
  LuPackage,
  LuPaintBucket,
  LuPuzzle,
  LuRuler,
  LuShapes,
  LuStar,
  LuTag,
  LuWarehouse,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Hyperlink,
  ItemThumbnail,
  MethodItemTypeIcon,
  Table,
  TrackingTypeIcon
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useStorageUnits } from "~/components/Form/StorageUnit";
import { StorageUnitDrillSelect } from "~/components/Form/StorageUnitDrillSelect";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useUrlParams } from "~/hooks";
import {
  itemReorderingPolicies,
  itemReplenishmentSystems
} from "~/modules/items";
import {
  getReorderPolicyDescription,
  ItemReorderPolicy
} from "~/modules/items/ui/Item/ItemReorderPolicy";
import type { action as mrpAction } from "~/routes/api+/mrp";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { itemTypes } from "../../inventory.models";
import type { InventoryItem } from "../../types";

type InventoryTableProps = {
  data: InventoryItem[];
  count: number;
  locationId: string;
  forms: ListItem[];
  substances: ListItem[];
  tags: string[];
  storageTypes: { id: string; name: string }[];
};

const InventoryTable = memo(
  ({
    data,
    count,
    locationId,
    forms,
    substances,
    tags,
    storageTypes
  }: InventoryTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();

    const translateReplenishment = useCallback(
      (v: string) =>
        v === "Buy" ? t`Buy` : v === "Make" ? t`Make` : t`Buy and Make`,
      [t]
    );

    const locations = useLocations();
    const unitOfMeasures = useUnitOfMeasure();
    const { options: storageUnitOptions } = useStorageUnits(locationId);

    const filters = useFilters();
    const materialSubstanceId = filters.getFilter("materialSubstanceId")?.[0];
    const materialFormId = filters.getFilter("materialFormId")?.[0];
    const numberFormatter = useNumberFormatter();
    const formatNumber = numberFormatter.format.bind(numberFormatter);

    const columns = useMemo<ColumnDef<InventoryItem>[]>(() => {
      return [
        {
          accessorKey: "readableIdWithRevision",
          header: t`Item ID`,
          cell: ({ row }) => (
            <HStack className="py-1">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                // @ts-expect-error
                type={row.original.type}
              />

              <Hyperlink
                to={`${path.to.inventoryItem(row.original.id!)}/?${params}`}
              >
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
          accessorKey: "quantityOnHand",
          header: t`On Hand`,
          cell: ({ row }) =>
            row.original.itemTrackingType === "Non-Inventory" ? (
              <TrackingTypeIcon type="Non-Inventory" />
            ) : (
              formatNumber(row.original.quantityOnHand)
            ),
          meta: {
            icon: <LuPackage />,
            renderTotal: true,
            formatter: formatNumber
          }
        },

        {
          accessorKey: "daysRemaining",
          header: t`Days`,
          cell: ({ row }) => formatNumber(row.original.daysRemaining),
          meta: {
            icon: <LuClock />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "leadTime",
          header: t`Lead Time`,
          cell: ({ row }) => formatNumber(row.original.leadTime),
          meta: {
            icon: <LuClock />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "reorderingPolicy",
          header: t`Reorder Policy`,
          cell: ({ row }) => {
            return (
              <HStack>
                <Tooltip>
                  <TooltipTrigger>
                    <ItemReorderPolicy
                      reorderingPolicy={row.original.reorderingPolicy}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {getReorderPolicyDescription(row.original)}
                  </TooltipContent>
                </Tooltip>
              </HStack>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: itemReorderingPolicies.map((policy) => ({
                label: <ItemReorderPolicy reorderingPolicy={policy} />,
                value: policy
              }))
            },
            icon: <LuCircleCheck />
          }
        },
        {
          accessorKey: "replenishmentSystem",
          header: t`Replenishment`,
          cell: (item) => (
            <Enumerable
              value={translateReplenishment(item.getValue<string>())}
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: itemReplenishmentSystems.map((type) => ({
                value: type,
                label: <Enumerable value={translateReplenishment(type)} />
              }))
            },
            icon: <LuLoaderCircle />
          }
        },

        {
          accessorKey: "usageLast30Days",
          header: t`Usage/Day (30d)`,
          cell: ({ row }) => formatNumber(row.original.usageLast30Days),
          meta: {
            icon: <LuCalculator />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "usageLast90Days",
          header: t`Usage/Day (90d)`,
          cell: ({ row }) => formatNumber(row.original.usageLast90Days),
          meta: {
            icon: <LuCalculator />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "quantityOnPurchaseOrder",
          header: t`On Purchase Order`,
          cell: ({ row }) => formatNumber(row.original.quantityOnPurchaseOrder),
          meta: {
            icon: <LuMoveUp className="text-emerald-500" />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "quantityOnProductionOrder",
          header: t`On Jobs`,
          cell: ({ row }) =>
            formatNumber(row.original.quantityOnProductionOrder),
          meta: {
            icon: <LuMoveUp className="text-emerald-500" />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "quantityOnProductionDemand",
          header: t`On Jobs`,
          cell: ({ row }) =>
            formatNumber(row.original.quantityOnProductionDemand),
          meta: {
            icon: <LuMoveDown className="text-red-500" />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "quantityOnSalesOrder",
          header: t`On Sales Order`,
          cell: ({ row }) => formatNumber(row.original.quantityOnSalesOrder),
          meta: {
            icon: <LuMoveDown className="text-red-500" />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "demandForecast",
          header: t`Demand Forecast`,
          cell: ({ row }) => formatNumber(row.original.demandForecast),
          meta: {
            icon: <LuMoveDown className="text-red-500" />,
            renderTotal: true,
            formatter: formatNumber
          }
        },
        {
          accessorKey: "unitOfMeasureCode",
          header: t`Unit of Measure`,
          cell: ({ row }) => {
            const unitOfMeasure = unitOfMeasures.find(
              (uom) => uom.value === row.original.unitOfMeasureCode
            );
            return (
              <Enumerable
                value={unitOfMeasure?.label ?? row.original.unitOfMeasureCode}
              />
            );
          },
          meta: {
            icon: <LuRuler />
          }
        },
        {
          accessorKey: "materialFormId",
          header: t`Shape`,
          cell: ({ row }) => {
            const form = forms.find(
              (f) => f.id === row.original.materialFormId
            );
            return <Enumerable value={form?.name ?? null} />;
          },
          meta: {
            filter: {
              type: "static",
              options: forms.map((form) => ({
                label: <Enumerable value={form.name} />,
                value: form.id
              }))
            },
            icon: <LuShapes />
          }
        },
        {
          accessorKey: "materialSubstanceId",
          header: t`Substance`,
          cell: ({ row }) => {
            const substance = substances.find(
              (s) => s.id === row.original.materialSubstanceId
            );
            return <Enumerable value={substance?.name ?? null} />;
          },
          meta: {
            filter: {
              type: "static",
              options: substances.map((substance) => ({
                label: <Enumerable value={substance.name ?? null} />,
                value: substance.id
              }))
            },
            icon: <LuGlassWater />
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
          accessorKey: "dimension",
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
          accessorKey: "type",
          header: t`Item Type`,
          cell: ({ row }) =>
            row.original.type && (
              <HStack>
                <MethodItemTypeIcon type={row.original.type} />
                <span>{row.original.type}</span>
              </HStack>
            ),
          meta: {
            filter: {
              type: "static",
              options: itemTypes.map((type) => ({
                label: (
                  <HStack spacing={2}>
                    <MethodItemTypeIcon type={type} />
                    <span>{type}</span>
                  </HStack>
                ),
                value: type
              }))
            },
            icon: <LuBox />
          }
        },
        {
          accessorKey: "tags",
          header: t`Tags`,
          cell: ({ row }) => (
            <HStack spacing={0} className="gap-1">
              {/* @ts-expect-error TS2339 */}
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
                value: tag,
                label: <Badge variant="secondary">{tag}</Badge>
              })),
              isArray: true
            },
            icon: <LuTag />
          }
        },
        {
          accessorKey: "storageTypeIds",
          header: t`Storage Type`,
          cell: ({ row }) => {
            const ids =
              (
                row.original as InventoryItem & {
                  storageTypeIds?: string[] | null;
                }
              ).storageTypeIds ?? [];
            return (
              <HStack spacing={0} className="gap-1">
                {ids.map((id) => {
                  const st = (storageTypes ?? []).find((s) => s.id === id);
                  return <Enumerable key={id} value={st?.name ?? null} />;
                })}
              </HStack>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: (storageTypes ?? []).map((st) => ({
                value: st.id,
                label: <Enumerable value={st.name} />
              })),
              isArray: true
            },
            pluralHeader: t`Storage Types`,
            icon: <LuWarehouse />
          }
        },
        {
          accessorKey: "storageUnitIds",
          header: t`Storage Unit`,
          cell: ({ row }) => {
            const ids =
              (
                row.original as InventoryItem & {
                  storageUnitIds?: string[] | null;
                }
              ).storageUnitIds ?? [];
            return (
              <HStack spacing={0} className="gap-1">
                {ids.map((id) => {
                  const opt = storageUnitOptions.find((o) => o.value === id);
                  const label = typeof opt?.label === "string" ? opt.label : id;
                  return <Enumerable key={id} value={label} />;
                })}
              </HStack>
            );
          },
          meta: {
            filter: {
              type: "custom",
              isArray: true,
              getLabel: (v: string) => {
                const opt = storageUnitOptions.find((o) => o.value === v);
                return typeof opt?.label === "string" ? opt.label : v;
              },
              render: ({ values, toggle }) => (
                <div className="flex flex-col gap-2">
                  {values.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {values.map((v) => {
                        const opt = storageUnitOptions.find(
                          (o) => o.value === v
                        );
                        const label =
                          typeof opt?.label === "string" ? opt.label : v;
                        return (
                          <Badge
                            key={v}
                            variant="secondary"
                            className="cursor-pointer gap-1 max-w-full"
                            onClick={() => toggle(v)}
                          >
                            <span className="truncate">{label}</span>
                            <LuX className="h-3 w-3 shrink-0" />
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                  <StorageUnitDrillSelect
                    locationId={locationId}
                    value={null}
                    onChange={(id) => {
                      if (id) toggle(id);
                    }}
                    allowCreate={false}
                  />
                </div>
              )
            },
            pluralHeader: t`Storage Units`,
            icon: <LuBoxes />
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
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" }
              ]
            },
            pluralHeader: t`Active Statuses`,
            icon: <LuCheck />
          }
        }
      ];
    }, [
      forms,
      locationId,
      materialFormId,
      materialSubstanceId,
      formatNumber,
      params,
      substances,
      tags,
      storageTypes,
      storageUnitOptions,
      unitOfMeasures,
      t,
      translateReplenishment
    ]);

    const defaultColumnVisibility = {
      active: false,
      tags: false,
      type: false,
      finish: false,
      grade: false,
      dimension: false,
      materialType: false,
      storageTypeIds: false,
      storageUnitIds: false
    };

    const defaultColumnPinning = {
      left: ["readableIdWithRevision"]
    };

    const mrpFetcher = useFetcher<typeof mrpAction>();

    return (
      <Table<InventoryItem>
        count={count}
        columns={columns}
        data={data}
        defaultColumnVisibility={defaultColumnVisibility}
        defaultColumnPinning={defaultColumnPinning}
        primaryAction={
          <div className="flex items-center gap-2">
            <Combobox
              asButton
              size="sm"
              value={locationId}
              options={locations}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(selected);
              }}
            />
            <mrpFetcher.Form method="post" action={path.to.api.mrp(locationId)}>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    type="submit"
                    variant="secondary"
                    rightIcon={<LuCirclePlay />}
                    isDisabled={mrpFetcher.state !== "idle"}
                    isLoading={mrpFetcher.state !== "idle"}
                  >
                    <Trans>Recalculate</Trans>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t`MRP runs automatically every 3 hours, but you can run it manually here.`}
                </TooltipContent>
              </Tooltip>
            </mrpFetcher.Form>
          </div>
        }
        title={t`Inventory`}
        table="inventory"
        withSavedView
      />
    );
  }
);

InventoryTable.displayName = "InventoryTable";

export default InventoryTable;

function getLocationPath(locationId: string) {
  return `${path.to.inventory}?location=${locationId}`;
}
