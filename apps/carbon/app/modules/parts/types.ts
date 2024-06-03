import type { Database } from "@carbon/database";
import type {
  getItemGroups,
  getItemGroupsList,
  getPart,
  getPartCost,
  getPartQuantities,
  getPartSuppliers,
  getParts,
  getServiceSuppliers,
  getServices,
  getUnitOfMeasure,
  getUnitOfMeasuresList,
} from "./parts.service";

export type PartCost = NonNullable<
  Awaited<ReturnType<typeof getPartCost>>
>["data"];

export type PartCostingMethod =
  Database["public"]["Enums"]["partCostingMethod"];

export type ItemGroup = NonNullable<
  Awaited<ReturnType<typeof getItemGroups>>["data"]
>[number];

export type ItemGroupListItem = NonNullable<
  Awaited<ReturnType<typeof getItemGroupsList>>["data"]
>[number];

export type PartQuantities = NonNullable<
  Awaited<ReturnType<typeof getPartQuantities>>["data"]
>;

export type PartReorderingPolicy =
  Database["public"]["Enums"]["partReorderingPolicy"];

export type PartReplenishmentSystem =
  Database["public"]["Enums"]["partReplenishmentSystem"];

export type PartSummary = NonNullable<
  Awaited<ReturnType<typeof getPart>>
>["data"];

export type PartSupplier = NonNullable<
  Awaited<ReturnType<typeof getPartSuppliers>>["data"]
>[number];

export type PartManufacturingPolicy =
  Database["public"]["Enums"]["partManufacturingPolicy"];

export type Part = NonNullable<
  Awaited<ReturnType<typeof getParts>>["data"]
>[number];

export type PartType = Database["public"]["Enums"]["partType"];

export type Service = NonNullable<
  Awaited<ReturnType<typeof getServices>>["data"]
>[number];

export type ServiceSupplier = NonNullable<
  Awaited<ReturnType<typeof getServiceSuppliers>>["data"]
>[number];

export type ServiceType = Database["public"]["Enums"]["serviceType"];

export type UnitOfMeasure = NonNullable<
  Awaited<ReturnType<typeof getUnitOfMeasure>>["data"]
>;

export type UnitOfMeasureListItem = NonNullable<
  Awaited<ReturnType<typeof getUnitOfMeasuresList>>["data"]
>[number];
