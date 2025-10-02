import type { FileObject } from "@supabase/storage-js";
import type {
  getJobByOperationId,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobOperationById,
  getJobOperationProcedure,
  getJobOperationsByWorkCenter,
  getKanbanByJobId,
  getLocationsByCompany,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getRecentJobOperationsByEmployee,
  getTrackedEntitiesByMakeMethodId,
  getTrackedInputs,
} from "./operations.service";

export type BaseOperation = NonNullable<
  Awaited<ReturnType<typeof getRecentJobOperationsByEmployee>>["data"]
>[number];

export type BaseOperationWithDetails = NonNullable<
  Awaited<ReturnType<typeof getJobOperationById>>["data"]
>[number];

type Durations = {
  duration: number;
  setupDuration: number;
  laborDuration: number;
  machineDuration: number;
};

export type Location = NonNullable<
  Awaited<ReturnType<typeof getLocationsByCompany>>["data"]
>[number];

export type Job = NonNullable<
  Awaited<ReturnType<typeof getJobByOperationId>>["data"]
>;

export type JobMaterial = NonNullable<
  Awaited<ReturnType<typeof getJobMaterialsByOperationId>>
>["materials"][number] & {
  isKitComponent?: boolean;
  kitParentId?: string;
};

export type Kanban = Awaited<ReturnType<typeof getKanbanByJobId>>["data"];

export type JobMakeMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMakeMethod>>["data"]
>;

export type JobOperationAttribute = NonNullable<
  Awaited<ReturnType<typeof getJobOperationProcedure>>["attributes"]
>[number];

export type JobOperationParameter = NonNullable<
  Awaited<ReturnType<typeof getJobOperationProcedure>>["parameters"]
>[number];

export type Operation = BaseOperation & Durations;
export type OperationWithDetails = BaseOperationWithDetails & Durations;

export type OperationSettings = {
  showCustomer: boolean;
  showDescription: boolean;
  showDueDate: boolean;
  showDuration: boolean;
  showEmployee: boolean;
  showProgress: boolean;
  showStatus: boolean;
  showThumbnail: boolean;
};

export type ProductionEvent = NonNullable<
  Awaited<ReturnType<typeof getProductionEventsForJobOperation>>["data"]
>[number];

export type ProductionQuantity = NonNullable<
  Awaited<ReturnType<typeof getProductionQuantitiesForJobOperation>>["data"]
>[number];

export type StorageItem = FileObject & {
  bucket: string;
};

export type TrackedEntity = NonNullable<
  Awaited<ReturnType<typeof getTrackedEntitiesByMakeMethodId>>["data"]
>[number];

export type TrackedInput = NonNullable<
  Awaited<ReturnType<typeof getTrackedInputs>>["data"]
>[number];

export type WorkCenter = NonNullable<
  Awaited<ReturnType<typeof getJobOperationsByWorkCenter>>["data"]
>[number];
