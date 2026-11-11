// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The result shape and the closed-lot rules every part of the inspection
// engine (`./quality.ts`) shares.
import type { Transaction } from "kysely";
import type { KyselyDatabase } from "./client.ts";

type Ok<T> = { data: T; error: null };
type Err = {
  data: null;
  error: { message: string; blockers?: unknown; cause?: unknown };
};
export type Result<T> = Ok<T> | Err;

export function errResult(message: string, blockers?: unknown): Err {
  return { data: null, error: { message, ...(blockers ? { blockers } : {}) } };
}

export function isDatabaseError(err: unknown): boolean {
  const e = err as { code?: unknown; severity?: unknown } | null;
  return typeof e?.code === "string" && typeof e?.severity === "string";
}

export function engineErrResult(err: unknown, fallback: string): Err {
  const code = (err as { code?: unknown } | null)?.code;
  if (isDatabaseError(err) && code !== "P0001") {
    const message =
      code === "40P01" || code === "40001"
        ? "Another change was saved at the same time. Try again."
        : fallback;
    return { data: null, error: { message, cause: err } };
  }
  return errResult(err instanceof Error ? err.message : fallback);
}

export type InspectionSource = "Receipt" | "Job Operation" | "Manual";

// Terminal lot statuses. Passed/Failed/Partial are all hard-terminal: once
// dispositioned, samples and measurements are immutable (Partial is the mixed
// close — some units passed, some failed, each already routed to its outcome).
// Cancelled is a manual lot taken off the queue with no verdict, or the lot
// of a voided receipt.
export const INSPECTION_CLOSED_STATUSES = [
  "Passed",
  "Failed",
  "Partial",
  "Cancelled"
] as const;

export function isInspectionClosed(status: string): boolean {
  return (INSPECTION_CLOSED_STATUSES as readonly string[]).includes(status);
}

// A receipt lot is closed once its receipt is voided: the stock it inspects was
// never received. Accepting it made the voided serials and batches Available
// again, and rejecting an untracked lot wrote the reversed stock off a second
// time. FOR SHARE waits for a void that is running, which locks the receipt.
export async function assertReceiptNotVoided(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  inspection: { sourceDocument: string; sourceDocumentId: string | null },
  lock: "share" | "noKeyUpdate" = "share"
): Promise<void> {
  if (inspection.sourceDocument !== "Receipt" || !inspection.sourceDocumentId)
    return;
  const query = trx
    .selectFrom("receipt")
    .select("status")
    .where("id", "=", inspection.sourceDocumentId)
    .where("companyId", "=", companyId);
  const receipt = await (lock === "share"
    ? query.forShare()
    : query.forNoKeyUpdate()
  ).executeTakeFirst();
  if (receipt?.status === "Voided") {
    throw new Error("The receipt of this inspection was voided");
  }
}
