import type { Database } from "@carbon/database";
import type { z } from "zod";
import type {
  ApprovalDocumentType,
  approvalRequestValidator,
  approvalRuleValidator
} from "./models";

// Derived straight from the DB types (NOT from `ReturnType<service>`) so this
// client-safe barrel never pulls the server-only `service.ts` (which imports
// `.server` modules) into the client graph. `getApprovalRuleByAmount` is a
// `select("*")` on `approvalRule`; `getApprovalRequestsByDocument` a `select("*")`
// on the `approvalRequests` view — so these are exactly those row shapes.

export type ApprovalFilters = {
  documentType?: ApprovalDocumentType | null;
  status?: ApprovalStatus | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type ApprovalRequest =
  Database["public"]["Views"]["approvalRequests"]["Row"];

export type ApprovalHistory = ApprovalRequest[];

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

export type ApprovalRule = Database["public"]["Tables"]["approvalRule"]["Row"];

export type ApprovalDecision = "Approved" | "Rejected";

export type ApprovalStatus = Database["public"]["Enums"]["approvalStatus"];

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
