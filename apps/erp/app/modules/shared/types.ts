import type { ColumnPinningState } from "@tanstack/react-table";
import type { z } from "zod";
import type { ModelUpload, StorageItem } from "~/types";
import type {
  itemType,
  methodItemType,
  methodType,
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator,
  SlideAnnotation,
  SlideSize,
  sourcingType,
  standardFactorType
} from "./shared.models";
import type { getNotes } from "./shared.service";

/** A `ModelUpload` read off an item, carrying the item it came from. */
export type ItemModelUpload = ModelUpload & { itemId: string | null };

export type BillOfMaterialNodeType =
  | "parent"
  | "line"
  | "assemblies"
  | "operations"
  | "materials"
  | "assembly"
  | "operation"
  | "material";

export type BillOfMaterialNode = {
  id: string;
  parentId?: string;
  label: string;
  type: BillOfMaterialNodeType;
  meta?: any;
  children?: BillOfMaterialNode[];
};

export enum DataType {
  Boolean = 1,
  Date = 2,
  List = 3,
  Numeric = 4,
  Text = 5,
  User = 6,
  Customer = 7,
  Supplier = 8,
  File = 9
}

export type MethodItemType = (typeof methodItemType)[number];

export type ItemType = (typeof itemType)[number];
export type MethodType = (typeof methodType)[number];
export type SourcingType = (typeof sourcingType)[number];

export type Note = NonNullable<
  Awaited<ReturnType<typeof getNotes>>["data"]
>[number];

export type OperationStepSlide = {
  id: string;
  stepId: string;
  // A slide is image XOR model: exactly one of imagePath / modelUploadId is set.
  imagePath: string | null;
  modelUploadId: string | null;
  caption: string | null;
  sortOrder: number;
  size: SlideSize | null;
  annotations: SlideAnnotation[] | null;
};

export type OperationStep = z.infer<typeof operationStepValidator> & {
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
  methodOperationStepSlide?: OperationStepSlide[];
};

export type OperationTool = z.infer<typeof operationToolValidator> & {
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
  // Phase 2 (tool ↔ step, many-to-many): the step ids this tool is scoped to. Empty = the
  // whole operation. Not part of the tier-agnostic validator; populated by the loader from
  // the methodOperationToolStep / jobOperationToolStep join rows.
  methodOperationStepIds?: string[];
  jobOperationStepIds?: string[];
};

export type OperationParameter = z.infer<typeof operationParameterValidator> & {
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};
export type OptimisticFileObject = Omit<
  StorageItem,
  "owner" | "updated_at" | "created_at" | "last_accessed_at" | "buckets"
>;

export type QuantityEffect = (quantity: number) => number;

export type SavedView = {
  id: string;
  table: string;
  columnOrder: string[];
  columnPinning: ColumnPinningState;
  columnVisibility: Record<string, boolean>;
  name: string;
  description?: string;
  sortOrder: number;
  sorts: string[];
  filters: string[];
};

export type StandardFactor = (typeof standardFactorType)[number];
