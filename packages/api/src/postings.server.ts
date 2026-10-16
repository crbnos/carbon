// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The postings a package that cannot import the app calls (`@carbon/jobs`,
// `@carbon/ee`). The app registers them once at start (`registerPostings`).
// Each runs as `serverFns.invoke` ran it and answers `{ data, error }`, with
// the `ServerFnError` it refused with.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerFnError } from "./errors";

/**
 * What the caller holds. With a `client`, the caller behind it must hold the
 * posting's permission first (as `serverFns.as` checked it); without one, the
 * posting runs as the system on `userId`'s behalf (`serverFns.system`).
 */
export type PostingHandles = {
  db: Kysely<KyselyDatabase>;
  companyId: string;
  userId: string;
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
