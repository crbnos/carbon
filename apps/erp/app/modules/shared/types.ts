import type { ColumnPinningState } from "@tanstack/react-table";
import type { z } from "zod";
import type { StorageItem } from "~/types";
import type {
  methodItemType,
  methodType,
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator,
  standardFactorType,
} from "./shared.models";
import type { getNotes } from "./shared.service";

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
}

export type MethodItemType = (typeof methodItemType)[number];
export type MethodType = (typeof methodType)[number];

export type Note = NonNullable<
  Awaited<ReturnType<typeof getNotes>>["data"]
>[number];

export type OperationStep = z.infer<typeof operationStepValidator> & {
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type OperationTool = z.infer<typeof operationToolValidator> & {
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
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
