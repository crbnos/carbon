import type { Database } from "@carbon/database";
import type {
  getActiveProductionEvents,
  getAssemblyComponentMappings,
  getAssemblyInstruction,
  getAssemblyInstructionStepMaterials,
  getAssemblyInstructionStepSlides,
  getAssemblyInstructionSteps,
  getAssemblyInstructionStepTools,
  getAssemblyInstructions,
  getAssemblyUnits,
  getBalloons,
  getFailureMode,
  getFailureModes,
  getInspectionDocument,
  getInspectionDocuments,
  getInspectionFeatures,
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
>[number] & { hasExpiredBatch?: boolean };

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTree>>["data"]
>[number]["data"];

export type JobOperation = NonNullable<
  Awaited<ReturnType<typeof getJobOperations>>["data"]
>[number];

export type JobPurchaseOrderLine = NonNullable<
  Awaited<ReturnType<typeof getJobPurchaseOrderLines>>["data"]
>[number];

export type JobMaterialPurchaseOrderLine = {
  itemId: string | null;
  purchaseQuantity: number | null;
  quantityReceived: number | null;
  status: Database["public"]["Enums"]["purchaseOrderStatus"] | null;
};

// An active job that produces a (manufactured) material item — the supply-side
// counterpart to JobMaterialPurchaseOrderLine.
export type JobMaterialSupplyJobLine = {
  itemId: string | null;
  status: Database["public"]["Enums"]["jobStatus"] | null;
};

export type PurchaseOrderStatus =
  Database["public"]["Enums"]["purchaseOrderStatus"];

export type JobStatus = Database["public"]["Enums"]["jobStatus"];

export type ItemOrderStatus = {
  needsOrder: boolean;
  needsJob: boolean;
  shortfall: number;
  status: PurchaseOrderStatus | null;
  supplyJobStatus: JobStatus | null;
  coveredByOnHand: boolean;
  isIssued: boolean;
  ordered: number;
  received: number;
};

export type JobOrderStatusCategory =
  | "issued"
  | "needsOrder"
  | "needsJob"
  | "planned"
  | "plannedJob"
  | "awaitingApproval"
  | "onOrder"
  | "received"
  | "inStock";

export type ItemShortfall = {
  shortfall: number;
  coveredByOnHand: boolean;
};

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

// --- Assembly Instructions ---------------------------------------------

export type AssemblyInstruction = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstruction>>["data"]
>;

export type AssemblyInstructionListItem = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstructions>>["data"]
>[number];

export type AssemblyInstructionStepRow = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstructionSteps>>["data"]
>[number];

export type AssemblyStepMaterial = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstructionStepMaterials>>["data"]
>[number];

export type AssemblyStepSlide = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstructionStepSlides>>["data"]
>[number];

export type AssemblyStepTool = NonNullable<
  Awaited<ReturnType<typeof getAssemblyInstructionStepTools>>["data"]
>[number];

export type AssemblyUnit = NonNullable<
  Awaited<ReturnType<typeof getAssemblyUnits>>["data"]
>[number];

export type AssemblyComponentMapping = NonNullable<
  Awaited<ReturnType<typeof getAssemblyComponentMappings>>["data"]
>[number];

// --- Inspection Documents -----------------------------------------------

export type InspectionDocument = NonNullable<
  Awaited<ReturnType<typeof getInspectionDocuments>>["data"]
>[number];

export type InspectionDocumentDetail = NonNullable<
  Awaited<ReturnType<typeof getInspectionDocument>>["data"]
>;

export type Balloon = NonNullable<
  Awaited<ReturnType<typeof getBalloons>>["data"]
>[number];

export type InspectionFeature = NonNullable<
  Awaited<ReturnType<typeof getInspectionFeatures>>["data"]
>[number];

export type BalloonFeature = {
  id: string;
  balloonNumber: number;
  description: string;
  nominalValue: number | null;
  tolerancePlus: number | null;
  toleranceMinus: number | null;
  unitOfMeasureCode: string | null;
};

export type InspectionDocumentContent = {
  pdfUrl: string | null;
  drawingNumber: string | null;
  features: BalloonFeature[];
};
