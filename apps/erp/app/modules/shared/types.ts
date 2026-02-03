import type { Database } from "@carbon/database";
import type { ColumnPinningState } from "@tanstack/react-table";
import type { z } from "zod";
import type { StorageItem } from "~/types";
import type {
  ApprovalDocumentType,
  approvalRequestValidator,
  approvalRuleValidator,
  methodItemType,
  methodType,
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator,
  standardFactorType
} from "./shared.models";
import type {
  getApprovalRequestsByDocument,
  getApprovalRuleByAmount,
  getNotes
} from "./shared.service";

export type ApprovalFilters = {
  documentType?: ApprovalDocumentType | null;
  status?: ApprovalStatus | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type ApprovalHistory = NonNullable<
  Awaited<ReturnType<typeof getApprovalRequestsByDocument>>["data"]
>;

export type ApprovalRequest =
  Database["public"]["Views"]["approvalRequests"]["Row"];

export type ApprovalRequestForApproveCheck = {
  amount: number | null;
  documentType: ApprovalDocumentType;
  companyId: string;
};

export type ApprovalRequestForCancelCheck = {
  requestedBy: string;
  status: string;
};

export type ApprovalRequestForViewCheck = {
  requestedBy: string;
  amount: number | null;
  documentType: ApprovalDocumentType;
  companyId: string;
};

export type ApprovalRule = NonNullable<
  Awaited<ReturnType<typeof getApprovalRuleByAmount>>["data"]
>;

export type ApprovalDecision = "Approved" | "Rejected";

export type ApprovalStatus = Database["public"]["Enums"]["approvalStatus"];

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

export type CreateApprovalRequestInput = Omit<
  z.infer<typeof approvalRequestValidator>,
  "id"
> & {
  companyId: string;
  requestedBy: string;
  createdBy: string;
};

export type UpsertApprovalRuleInput =
  | (Omit<z.infer<typeof approvalRuleValidator>, "id"> & {
      companyId: string;
      createdBy: string;
    })
  | (Omit<z.infer<typeof approvalRuleValidator>, "id"> & {
      id: string;
      updatedBy: string;
    });
