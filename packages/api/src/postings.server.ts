// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The postings a caller that cannot import the ERP calls: `@carbon/jobs` and
// `@carbon/ee` in the ERP's process, MES over a signed HTTP call. The ERP
// registers them once at start (`registerPostings`). Each answers
// `{ data, error }`, with the `ServerFnError` it refused with.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { ServerFnError } from "./errors";
import type {
  batchOperationsInput,
  CreateInput,
  CreateResult,
  IssueResult,
  issueInput,
  PostProductionEventResult,
  postInventoryAdjustmentInput,
  postMaintenanceEventInput,
  postPickingInput,
  postProductionEventInput,
  recalculateInput,
  triggerReworkInput
} from "./postings";

/**
 * What the caller holds. With a `client`, the caller behind it must hold the
 * posting's permission first; without one, the posting runs as the system on
 * `userId`'s behalf.
 * Without `companyGroupId`, it is read from the company.
 */
export type PostingHandles = {
  db: Kysely<KyselyDatabase>;
  companyId: string;
  userId: string;
  companyGroupId?: string;
  client?: SupabaseClient<Database>;
};

export type PostingOutcome<T> =
  | { data: T; error: null }
  | { data: null; error: ServerFnError };

type InvoiceAutomation = Database["public"]["Enums"]["invoiceAutomation"];

export type DraftedRentalInvoice = {
  invoiceId: string;
  rentalAgreementId: string;
  /** The agreement's effective invoice automation. */
  mode: InvoiceAutomation;
  /** Set when a person must review the draft before it is posted. */
  holdReason: string | null;
};

export type RentalInvoiceGenerationResult = {
  invoices: DraftedRentalInvoice[];
  /** `invoices.map(i => i.invoiceId)`. */
  invoiceIds: string[];
  /** Early-return credits, one Draft credit memo per agreement. */
  creditMemos: { memoId: string; rentalAgreementId: string }[];
  /** Agreements whose transaction rolled back; their rows stay unbilled. */
  failures: { rentalAgreementId: string; error: string }[];
};

export type DraftedContractInvoice = {
  invoiceId: string;
  customerContractId: string;
  /** The contract's effective invoice automation. */
  mode: InvoiceAutomation;
  /** Set when a person must review the draft before it is posted. */
  holdReason: string | null;
};

export type ContractInvoiceGenerationResult = {
  invoices: DraftedContractInvoice[];
  /** `invoices.map(i => i.invoiceId)`. */
  invoiceIds: string[];
  /** Contracts whose transaction rolled back; their invoices stay Planned. */
  failures: { customerContractId: string; error: string }[];
};

export type LeaseInvoiceGenerationResult = {
  invoices: { invoiceId: string; leaseId: string }[];
  /** `invoices.map(i => i.invoiceId)`. */
  invoiceIds: string[];
  /** Leases whose transaction rolled back; their rows stay Pending. */
  failures: { leaseId: string; error: string }[];
};

export type KanbanReplenishOutcome =
  | {
      kanbanId: string;
      outcome: "created";
      id: string;
      stockTransferId: string;
    }
  | { kanbanId: string; outcome: "at-level"; projectedQuantity: number }
  | { kanbanId: string; outcome: "invalid"; reason: string };

/** Each posting's input, and the result its callers read. */
export type PostingContract = {
  "post-sales-invoice": { input: { invoiceId: string }; output: unknown };
  "post-purchase-invoice": { input: { invoiceId: string }; output: unknown };
  "post-receipt": { input: { receiptId: string }; output: unknown };
  "post-shipment": {
    input: { type: "post" | "void"; shipmentId: string; postingDate?: string };
    output: unknown;
  };
  "post-payment": {
    input: {
      type?: "post" | "void";
      paymentId: string;
      /** A fee a payment processor withheld before the cash reached the bank. */
      fee?: { amount: number; accountId: string; description: string };
    };
    output: unknown;
  };
  "post-charge": {
    input: { type?: "post" | "void"; chargeId: string };
    output: unknown;
  };
  "update-purchased-prices": {
    input:
      | {
          source: "purchaseOrder";
          purchaseOrderId: string;
          updatePrices?: boolean;
          updateLeadTimes?: boolean;
        }
      | {
          source: "purchaseInvoice";
          invoiceId: string;
          updatePrices?: boolean;
          updateLeadTimes?: boolean;
        };
    output: unknown;
  };
  "kanban-replenish": {
    input: { mode: "level"; kanbanIds: string[] };
    output: { results: KanbanReplenishOutcome[] };
  };
  "create-rental-invoices": {
    input: { asOf: string };
    output: RentalInvoiceGenerationResult;
  };
  "create-contract-invoices": {
    input: { asOf: string };
    output: ContractInvoiceGenerationResult;
  };
  "create-lease-invoices": {
    input: { asOf: string };
    output: LeaseInvoiceGenerationResult;
  };
  "propose-revenue-recognition-run": {
    input: { periodEnd: string; type?: "Revenue Recognition" | "Lease" };
    output: { id: string; runId: string; lineCount: number } | null;
  };
  issue: { input: z.input<typeof issueInput>; output: IssueResult };
  "post-picking": {
    input: z.input<typeof postPickingInput>;
    output: { success: boolean; splitEntityId: string | undefined };
  };
  "post-production-event": {
    input: z.input<typeof postProductionEventInput>;
    output: PostProductionEventResult;
  };
  "post-maintenance-event": {
    input: z.input<typeof postMaintenanceEventInput>;
    output: { success: boolean; journalIds: string[] };
  };
  "post-inventory-adjustment": {
    input: z.input<typeof postInventoryAdjustmentInput>;
    output: { success: boolean; itemLedger: { id: string } | null };
  };
  create: { input: CreateInput; output: CreateResult };
  "batch-operations": {
    input: z.input<typeof batchOperationsInput>;
    output: { success: boolean };
  };
  recalculate: {
    input: z.input<typeof recalculateInput>;
    output: { success: boolean };
  };
  "trigger-rework": {
    input: z.input<typeof triggerReworkInput>;
    output: {
      success: boolean;
      reworkId: string;
      clonedOperationIds: string[];
      operationsCloned: number;
    };
  };
};

export type PostingName = keyof PostingContract;

export type Postings = {
  [K in PostingName]: (
    handles: PostingHandles,
    input: PostingContract[K]["input"]
  ) => Promise<PostingOutcome<PostingContract[K]["output"]>>;
};

let registered: Postings | null = null;

/** Called once at server start with the app's postings. */
export function registerPostings(postings: Postings) {
  registered = postings;
}

export function posting<K extends PostingName>(
  name: K,
  handles: PostingHandles,
  input: PostingContract[K]["input"]
): Promise<PostingOutcome<PostingContract[K]["output"]>> {
  if (!registered) {
    throw new Error(
      `posting("${name}"): the app has not called registerPostings`
    );
  }
  return registered[name](handles, input);
}

/** {@link posting}, throwing its refusal: for a caller that lets it fail. */
export async function postingOrThrow<K extends PostingName>(
  name: K,
  handles: PostingHandles,
  input: PostingContract[K]["input"]
): Promise<PostingContract[K]["output"]> {
  const result = await posting(name, handles, input);
  if (result.error) throw result.error;
  return result.data;
}
