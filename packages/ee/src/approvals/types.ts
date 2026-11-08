// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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

/** One document under approval; every `document.server` helper takes this. */
export type ApprovalDocumentRef = {
  documentType: ApprovalDocumentType;
  documentId: string;
  companyId: string;
};

/** Several documents of one type, for the bulk helpers. */
export type ApprovalDocumentsRef = Omit<ApprovalDocumentRef, "documentId"> & {
  documentIds: string[];
};

/** What a document page needs to render its approval controls. */
export type DocumentApprovalState = {
  pendingRequestId: string | null;
  pendingRequestedBy: string | null;
  /** Whether the user is an approver under the rule, pending request or not. */
  canApprove: boolean;
  isRequired: boolean;
  lastDecision: {
    status: ApprovalDecision;
    decisionBy: string | null;
    notes: string | null;
    decisionAt: string | null;
  } | null;
};

export type ApprovalStatus = Database["public"]["Enums"]["approvalStatus"];

/** What is scrapped, as a scrap route describes it to `describeScrap`. */
export type ScrapSubject =
  | {
      type: "operation";
      jobOperationId: string;
      quantity: number;
      trackedEntityId?: string | null;
      scrapReasonId?: string | null;
      notes?: string | null;
    }
  | {
      type: "material";
      jobMaterialId: string;
      trackedEntityId: string;
      scrapReasonId?: string | null;
      notes?: string | null;
    }
  | {
      type: "batch";
      jobOperationBatchId: string;
      members: { jobOperationId: string; scrapQuantity: number }[];
    };

/** The `scrapRequest` a scrap would be recorded as, with its estimated value. */
export type ScrapDescription = {
  jobId: string | null;
  jobOperationId: string | null;
  jobOperationBatchId: string | null;
  jobMaterialId: string | null;
  trackedEntityId: string | null;
  itemId: string | null;
  scrapReasonId: string | null;
  notes: string | null;
  quantity: number;
  estimatedValue: number;
};

/** A person who may sign a scrap at the tablet. */
export type ScrapApprover = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

/**
 * What a scrap route answers when the scrap needs an approver: the modal shows
 * the value and the approvers, then sends the same form with an approver and
 * their PIN. `error` is set when the last attempt was refused.
 */
export type ScrapApprovalPrompt = {
  estimatedValue: number;
  /** The company's base currency, which the value and the tiers are in. */
  currencyCode: string;
  decimalPlaces: number;
  approvers: ScrapApprover[];
  error?: string;
};

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
