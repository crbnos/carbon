import type { Database } from "@carbon/database";
import type {
  getConsumables,
  getFixtures,
  getItemCost,
  getItemGroups,
  getItemGroupsList,
  getItemQuantities,
  getItemSuppliers,
  getMaterialForms,
  getMaterialSubstances,
  getMaterials,
  getPart,
  getParts,
  getServices,
  getTool,
  getTools,
  getUnitOfMeasure,
  getUnitOfMeasuresList,
} from "./items.service";

export type Consumable = NonNullable<
  Awaited<ReturnType<typeof getConsumables>>["data"]
>[number];

export type Fixture = NonNullable<
  Awaited<ReturnType<typeof getFixtures>>["data"]
>[number];

export type ItemCost = NonNullable<
  Awaited<ReturnType<typeof getItemCost>>
>["data"];

export type ItemCostingMethod =
  Database["public"]["Enums"]["itemCostingMethod"];

export type ItemGroup = NonNullable<
  Awaited<ReturnType<typeof getItemGroups>>["data"]
>[number];

export type ItemGroupListItem = NonNullable<
  Awaited<ReturnType<typeof getItemGroupsList>>["data"]
>[number];

export type ItemQuantities = NonNullable<
  Awaited<ReturnType<typeof getItemQuantities>>["data"]
>;

export type ItemReorderingPolicy =
  Database["public"]["Enums"]["itemReorderingPolicy"];

export type ItemReplenishmentSystem =
  Database["public"]["Enums"]["itemReplenishmentSystem"];

export type ItemSupplier = NonNullable<
  Awaited<ReturnType<typeof getItemSuppliers>>["data"]
>[number];

export type InventoryItemType =
  Database["public"]["Enums"]["itemInventoryType"];

export type Material = NonNullable<
  Awaited<ReturnType<typeof getMaterials>>["data"]
>[number];

export type MaterialForm = NonNullable<
  Awaited<ReturnType<typeof getMaterialForms>>["data"]
>[number];

export type MaterialSubstance = NonNullable<
  Awaited<ReturnType<typeof getMaterialSubstances>>["data"]
>[number];

export type PartManufacturingPolicy =
  Database["public"]["Enums"]["partManufacturingPolicy"];

export type Part = NonNullable<
  Awaited<ReturnType<typeof getParts>>["data"]
>[number];

export type PartSummary = NonNullable<
  Awaited<ReturnType<typeof getPart>>
>["data"];

export type Service = NonNullable<
  Awaited<ReturnType<typeof getServices>>["data"]
>[number];

export type ServiceType = Database["public"]["Enums"]["serviceType"];

export type Tool = NonNullable<
  Awaited<ReturnType<typeof getTools>>["data"]
>[number];

export type ToolSummary = NonNullable<
  Awaited<ReturnType<typeof getTool>>
>["data"];

export type UnitOfMeasure = NonNullable<
  Awaited<ReturnType<typeof getUnitOfMeasure>>["data"]
>;

export type UnitOfMeasureListItem = NonNullable<
  Awaited<ReturnType<typeof getUnitOfMeasuresList>>["data"]
>[number];
