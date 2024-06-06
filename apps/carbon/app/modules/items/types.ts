import type { Database } from "@carbon/database";
import type {
  getItemCost,
  getItemGroups,
  getItemGroupsList,
  getItemQuantities,
  getItemSuppliers,
  getPart,
  getParts,
  getServices,
  getUnitOfMeasure,
  getUnitOfMeasuresList,
} from "./items.service";

export type ItemCost = NonNullable<
  Awaited<ReturnType<typeof getItemCost>>
>["data"];

export type PartCostingMethod =
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

export type PartSummary = NonNullable<
  Awaited<ReturnType<typeof getPart>>
>["data"];

export type ItemSupplier = NonNullable<
  Awaited<ReturnType<typeof getItemSuppliers>>["data"]
>[number];

export type PartManufacturingPolicy =
  Database["public"]["Enums"]["partManufacturingPolicy"];

export type Part = NonNullable<
  Awaited<ReturnType<typeof getParts>>["data"]
>[number];

export type PartType = Database["public"]["Enums"]["itemInventoryType"];

export type Service = NonNullable<
  Awaited<ReturnType<typeof getServices>>["data"]
>[number];

export type ServiceType = Database["public"]["Enums"]["serviceType"];

export type UnitOfMeasure = NonNullable<
  Awaited<ReturnType<typeof getUnitOfMeasure>>["data"]
>;

export type UnitOfMeasureListItem = NonNullable<
  Awaited<ReturnType<typeof getUnitOfMeasuresList>>["data"]
>[number];
