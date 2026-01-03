import type {
  getActiveProductionEvents,
  getFailureMode,
  getFailureModes,
  getJob,
  getJobMakeMethodById,
  getJobMaterialsWithQuantityOnHand,
  getJobMethodTree,
  getJobOperations,
  getJobPurchaseOrderLines,
  getMaintenanceDispatch,
  getMaintenanceDispatchComments,
  getMaintenanceDispatchEvents,
  getMaintenanceDispatches,
  getMaintenanceDispatchItems,
  getMaintenanceDispatchWorkCenters,
  getMaintenanceSchedule,
  getMaintenanceScheduleItems,
  getMaintenanceSchedules,
  getProcedure,
  getProcedureParameters,
  getProcedureSteps,
  getProcedures,
  getProductionEvents,
  getProductionPlanning,
  getProductionProjections,
  getProductionQuantities,
  getScrapReasons
} from "./production.service";

export type ActiveProductionEvent = NonNullable<
  Awaited<ReturnType<typeof getActiveProductionEvents>>["data"]
>[number];

export type DemandProjection = NonNullable<
  Awaited<ReturnType<typeof getProductionProjections>>["data"]
>[number];

export type FailureMode = NonNullable<
  Awaited<ReturnType<typeof getFailureModes>>["data"]
>[number];

export type FailureModeDetail = NonNullable<
  Awaited<ReturnType<typeof getFailureMode>>["data"]
>;

export type MaintenanceDispatch = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatches>>["data"]
>[number];

export type MaintenanceDispatchDetail = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatch>>["data"]
>;

export type MaintenanceDispatchComment = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchComments>>["data"]
>[number];

export type MaintenanceDispatchEvent = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchEvents>>["data"]
>[number];

export type MaintenanceDispatchItem = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchItems>>["data"]
>[number];

export type MaintenanceDispatchWorkCenter = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceDispatchWorkCenters>>["data"]
>[number];

export type MaintenanceSchedule = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceSchedules>>["data"]
>[number];

export type MaintenanceScheduleDetail = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceSchedule>>["data"]
>;

export type MaintenanceScheduleItem = NonNullable<
  Awaited<ReturnType<typeof getMaintenanceScheduleItems>>["data"]
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

export type ProcedureStep = NonNullable<
  Awaited<ReturnType<typeof getProcedureSteps>>["data"]
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
