import type {
  getActiveProductionEvents,
  getJob,
  getJobMakeMethodById,
  getJobMaterialsWithQuantityOnHand,
  getJobMethodTree,
  getJobOperations,
  getJobPurchaseOrderLines,
  getProcedure,
  getProcedureAttributes,
  getProcedureParameters,
  getProcedures,
  getProductionEvents,
  getProductionPlanning,
  getProductionProjections,
  getProductionQuantities,
  getScrapReasons,
} from "./production.service";

export type ActiveProductionEvent = NonNullable<
  Awaited<ReturnType<typeof getActiveProductionEvents>>["data"]
>[number];

export type DemandForecast = NonNullable<
  Awaited<ReturnType<typeof getProductionProjections>>["data"]
>[number];

export type Job = NonNullable<Awaited<ReturnType<typeof getJob>>["data"]>;

export type JobMakeMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMakeMethodById>>["data"]
>;

export type JobMaterial = NonNullable<
  Awaited<ReturnType<typeof getJobMaterialsWithQuantityOnHand>>["data"]
>[number];

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTree>>["data"]
>[number]["data"];

export type JobOperation = NonNullable<
  Awaited<ReturnType<typeof getJobOperations>>["data"]
>[number];

export type JobPurchaseOrderLine = NonNullable<
  Awaited<ReturnType<typeof getJobPurchaseOrderLines>>["data"]
>[number];

export type ProductionEvent = NonNullable<
  Awaited<ReturnType<typeof getProductionEvents>>["data"]
>[number];

export type ProductionQuantity = NonNullable<
  Awaited<ReturnType<typeof getProductionQuantities>>["data"]
>[number];

export type Procedures = NonNullable<
  Awaited<ReturnType<typeof getProcedures>>["data"]
>[number];

export type ProcedureAttribute = NonNullable<
  Awaited<ReturnType<typeof getProcedureAttributes>>["data"]
>[number];

export type ProcedureParameter = NonNullable<
  Awaited<ReturnType<typeof getProcedureParameters>>["data"]
>[number];

export type Procedure = NonNullable<
  Awaited<ReturnType<typeof getProcedure>>["data"]
>;

export type ProductionPlanningItem = NonNullable<
  Awaited<ReturnType<typeof getProductionPlanning>>["data"]
>[number];

export type ScrapReason = NonNullable<
  Awaited<ReturnType<typeof getScrapReasons>>["data"]
>[number];
