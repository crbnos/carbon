import type { FileObject } from "@supabase/storage-js";
import type {
  getJobByOperationId,
  getJobMaterialsByOperationId,
  getJobOperationById,
  getJobOperationsByWorkCenter,
  getLocationsByCompany,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getRecentJobOperationsByEmployee,
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
  Awaited<ReturnType<typeof getJobMaterialsByOperationId>>["data"]
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

export type WorkCenter = NonNullable<
  Awaited<ReturnType<typeof getJobOperationsByWorkCenter>>["data"]
>[number];
