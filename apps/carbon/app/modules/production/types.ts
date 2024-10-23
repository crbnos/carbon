import type {
  getJob,
  getJobMaterials,
  getJobMethodTree,
  getJobOperations,
  getProductionEvents,
  getProductionQuantities,
  getScrapReasons,
} from "./production.service";

export type Job = NonNullable<Awaited<ReturnType<typeof getJob>>["data"]>;

export type JobMaterial = NonNullable<
  Awaited<ReturnType<typeof getJobMaterials>>["data"]
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

export type ScrapReason = NonNullable<
  Awaited<ReturnType<typeof getScrapReasons>>["data"]
>[number];
