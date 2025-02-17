import type {
  getActiveProductionEvents,
  getJob,
  getJobMaterialsWithQuantityOnHand,
  getJobMethodTree,
  getJobOperations,
  getProcedure,
  getProcedures,
  getProductionEvents,
  getProductionQuantities,
  getScrapReasons,
} from "./production.service";

export type ActiveProductionEvent = NonNullable<
  Awaited<ReturnType<typeof getActiveProductionEvents>>["data"]
>[number];

export type Job = NonNullable<Awaited<ReturnType<typeof getJob>>["data"]>;

export type JobMaterial = NonNullable<
  Awaited<ReturnType<typeof getJobMaterialsWithQuantityOnHand>>["data"]
>[number];

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTree>>["data"]
>[number]["data"];

export type JobOperation = NonNullable<
  Awaited<ReturnType<typeof getJobOperations>>["data"]
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

export type Procedure = NonNullable<
  Awaited<ReturnType<typeof getProcedure>>["data"]
>;

export type ScrapReason = NonNullable<
  Awaited<ReturnType<typeof getScrapReasons>>["data"]
>[number];
