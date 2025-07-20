import type { Database } from "@carbon/database";
import type {
  getConfigurationParameters,
  getConfigurationRules,
  getConsumable,
  getConsumables,
  getItemCost,
  getItemCostHistory,
  getItemCustomerParts,
  getItemFiles,
  getItemPostingGroups,
  getItemPostingGroupsList,
  getItemQuantities,
  getItemShelfQuantities,
  getMakeMethods,
  getMaterial,
  getMaterialFinishes,
  getMaterialForms,
  getMaterialGrades,
  getMaterialSubstances,
  getMaterials,
  getMethodMaterials,
  getMethodOperations,
  getMethodTreeArray,
  getPart,
  getParts,
  getPickMethods,
  getServices,
  getSupplierParts,
  getTool,
  getTools,
  getUnitOfMeasure,
  getUnitOfMeasuresList,
} from "./items.service";

export type ConfigurationParameter = NonNullable<
  Awaited<ReturnType<typeof getConfigurationParameters>>["parameters"]
>[number];

export type ConfigurationRule = NonNullable<
  Awaited<ReturnType<typeof getConfigurationRules>>
>[number];

export type ConfigurationParameterGroup = NonNullable<
  Awaited<ReturnType<typeof getConfigurationParameters>>["groups"]
>[number];

export type Consumable = NonNullable<
  Awaited<ReturnType<typeof getConsumables>>["data"]
>[number];

export type ConsumableSummary = NonNullable<
  Awaited<ReturnType<typeof getConsumable>>
>["data"];

export type CustomerPart = NonNullable<
  Awaited<ReturnType<typeof getItemCustomerParts>>["data"]
>[number];

export type Form = NonNullable<
  Awaited<ReturnType<typeof getMaterialForms>>["data"]
>[number];

export type InventoryItemType = Database["public"]["Enums"]["itemTrackingType"];

export type ItemCost = NonNullable<
  Awaited<ReturnType<typeof getItemCost>>
>["data"];

export type ItemCostHistory = NonNullable<
  Awaited<ReturnType<typeof getItemCostHistory>>
>["data"];

export type ItemCostingMethod =
  Database["public"]["Enums"]["itemCostingMethod"];

export type ItemFile = NonNullable<
  Awaited<ReturnType<typeof getItemFiles>>
>[number];

export type ItemPostingGroup = NonNullable<
  Awaited<ReturnType<typeof getItemPostingGroups>>["data"]
>[number];

export type ItemPostingGroupListItem = NonNullable<
  Awaited<ReturnType<typeof getItemPostingGroupsList>>["data"]
>[number];

export type ItemQuantities = NonNullable<
  Awaited<ReturnType<typeof getItemQuantities>>["data"]
>;

export type ItemShelfQuantities = NonNullable<
  Awaited<ReturnType<typeof getItemShelfQuantities>>["data"]
>[number];

export type ItemReorderingPolicy =
  Database["public"]["Enums"]["itemReorderingPolicy"];

export type ItemReplenishmentSystem =
  Database["public"]["Enums"]["itemReplenishmentSystem"];

export type MakeMethod = NonNullable<
  Awaited<ReturnType<typeof getMakeMethods>>["data"]
>[number];

export type Material = NonNullable<
  Awaited<ReturnType<typeof getMaterials>>["data"]
>[number];

export type MaterialFinish = NonNullable<
  Awaited<ReturnType<typeof getMaterialFinishes>>["data"]
>[number];

export type MaterialGrade = NonNullable<
  Awaited<ReturnType<typeof getMaterialGrades>>["data"]
>[number];

export type MaterialSummary = NonNullable<
  Awaited<ReturnType<typeof getMaterial>>
>["data"];

export type Method = NonNullable<
  Awaited<ReturnType<typeof getMethodTreeArray>>["data"]
>[number];

export type MethodMaterial = NonNullable<
  Awaited<ReturnType<typeof getMethodMaterials>>["data"]
>[number];

export type MethodOperation = NonNullable<
  Awaited<ReturnType<typeof getMethodOperations>>["data"]
>[number];

export type Part = NonNullable<
  Awaited<ReturnType<typeof getParts>>["data"]
>[number];

export type PartCustomerPart = NonNullable<
  Awaited<ReturnType<typeof getItemCustomerParts>>
>["data"];

export type PartSummary = NonNullable<
  Awaited<ReturnType<typeof getPart>>
>["data"];

export type PickMethod = NonNullable<
  Awaited<ReturnType<typeof getPickMethods>>["data"]
>[number];

export type Service = NonNullable<
  Awaited<ReturnType<typeof getServices>>["data"]
>[number];

export type ServiceType = Database["public"]["Enums"]["serviceType"];

export type Substance = NonNullable<
  Awaited<ReturnType<typeof getMaterialSubstances>>["data"]
>[number];

export type SupplierPart = NonNullable<
  Awaited<ReturnType<typeof getSupplierParts>>["data"]
>[number];

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
