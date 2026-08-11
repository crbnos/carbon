import type { Database } from "@carbon/database";
import type {
  getChangeNotice,
  getChangeNoticeActions,
  getChangeNotices,
  getChangeNoticeTypes,
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
  getItemStorageUnitQuantities,
  getMakeMethods,
  getMaterial,
  getMaterialDimensions,
  getMaterialFinishes,
  getMaterialForms,
  getMaterialGrades,
  getMaterialSubstances,
  getMaterials,
  getMaterialTypes,
  getMethodMaterials,
  getMethodOperations,
  getMethodTreeArray,
  getPart,
  getParts,
  getPickMethods,
  getService,
  getServices,
  getSupplierParts,
  getTool,
  getTools,
  getUnitOfMeasure,
  getUnitOfMeasuresList
} from "./items.service";

export type ItemRevisionStatus =
  Database["public"]["Enums"]["itemRevisionStatus"];

// The single change notice (base table, NOT-NULL columns) — the shape detail
// routes and the properties/header/explorer components consume via useRouteData.
export type ChangeNotice = NonNullable<
  Awaited<ReturnType<typeof getChangeNotice>>["data"]
>;

// A row of the change-notices LIST — the `changeOrders` view, which additionally
// rolls up `itemIds` (text[]) and `affectedItems` (jsonb) per CN. View columns are
// all nullable, so this is a distinct type from the single-CN `ChangeNotice`.
export type ChangeNoticeListItem = NonNullable<
  Awaited<ReturnType<typeof getChangeNotices>>["data"]
>[number];

export type ChangeNoticeType = NonNullable<
  Awaited<ReturnType<typeof getChangeNoticeTypes>>["data"]
>[number];

export type ChangeNoticeStatus =
  Database["public"]["Enums"]["changeOrderStatus"];

// Includes the `linearIssue` / `jiraIssue` mappings that `getChangeNoticeActions` hydrates.
export type ChangeNoticeActionTask = NonNullable<
  Awaited<ReturnType<typeof getChangeNoticeActions>>["data"]
>[number];

export type ChangeNoticeRequiredAction =
  Database["public"]["Tables"]["changeOrderRequiredAction"]["Row"];

export type MaterialConfigurationData = {
  materialId?: string;
  materialSubstanceId?: string;
  materialFormId?: string;
  materialTypeId?: string;
  materialGradeId?: string;
  materialFinishId?: string;
};

export type ConfigurationParameter = NonNullable<
  Awaited<ReturnType<typeof getConfigurationParameters>>["parameters"]
>[number];

export type ConfigurationRule = NonNullable<
  Awaited<ReturnType<typeof getConfigurationRules>>
>[number];

export type ConfigurationParameterGroup = NonNullable<
  Awaited<ReturnType<typeof getConfigurationParameters>>["groups"]
>[number];

// The `X`/`XListItem` pairs below are deliberately separate: `X` is the full
// view row that detail screens read, `XListItem` is exactly what the list
// query selects. Defining `X` from the list getter is what broke ~250 call
// sites when the list selects were narrowed.
export type Consumable = Database["public"]["Views"]["consumables"]["Row"];

export type ConsumableListItem = NonNullable<
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

export type ItemStorageUnitQuantities = NonNullable<
  Awaited<ReturnType<typeof getItemStorageUnitQuantities>>["data"]
>[number];

export type ItemReorderingPolicy =
  Database["public"]["Enums"]["itemReorderingPolicy"];

export type ItemReplenishmentSystem =
  Database["public"]["Enums"]["itemReplenishmentSystem"];

export type MakeMethod = NonNullable<
  Awaited<ReturnType<typeof getMakeMethods>>["data"]
>[number];

export type Material = Database["public"]["Views"]["materials"]["Row"];

export type MaterialListItem = NonNullable<
  Awaited<ReturnType<typeof getMaterials>>["data"]
>[number];

export type MaterialDimension = NonNullable<
  Awaited<ReturnType<typeof getMaterialDimensions>>["data"]
>[number];

export type MaterialFinish = NonNullable<
  Awaited<ReturnType<typeof getMaterialFinishes>>["data"]
>[number];

export type MaterialGrade = NonNullable<
  Awaited<ReturnType<typeof getMaterialGrades>>["data"]
>[number];

export type MaterialType = NonNullable<
  Awaited<ReturnType<typeof getMaterialTypes>>["data"]
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

export type Part = Database["public"]["Views"]["parts"]["Row"];

export type PartListItem = NonNullable<
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

export type Service = Database["public"]["Views"]["services"]["Row"];

export type ServiceListItem = NonNullable<
  Awaited<ReturnType<typeof getServices>>["data"]
>[number];

export type ServiceSummary = NonNullable<
  Awaited<ReturnType<typeof getService>>
>["data"];

export type Substance = NonNullable<
  Awaited<ReturnType<typeof getMaterialSubstances>>["data"]
>[number];

export type SupplierPart = NonNullable<
  Awaited<ReturnType<typeof getSupplierParts>>["data"]
>[number];

export type Tool = Database["public"]["Views"]["tools"]["Row"];

export type ToolListItem = NonNullable<
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
