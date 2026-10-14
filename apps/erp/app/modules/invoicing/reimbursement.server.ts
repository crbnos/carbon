// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { serverFns } from "@carbon/server-functions";
import { EPSILON } from "@carbon/utils";
import { getDatabaseClient } from "~/services/database.server";

/**
 * The ONE module the ERP runs `post-reimbursement` from, so the Post action
 * route and the edit page's `save-and-post` intent cannot drift apart.
 *
 * Deliberately NOT re-exported from `apps/erp/app/modules/invoicing/index.ts`:
 * that barrel is imported by client components, and a `.server` module that
 * reaches the client graph fails the React Router build.
 */
async function runPostReimbursement(
  type: "post" | "void",
  args: { reimbursementId: string; companyId: string; userId: string },
  fallbackMessage: string
): Promise<{ error: string | null }> {
  // The caller's route already checked `update: invoicing`.
  const result = await serverFns
    .system({
      db: getDatabaseClient(),
      companyId: args.companyId,
      userId: args.userId
    })
    .invoke("post-reimbursement", {
      type,
      reimbursementId: args.reimbursementId
    });
  return {
    error: result.error ? result.error.message || fallbackMessage : null
  };
}

export function postReimbursement(args: {
  reimbursementId: string;
  companyId: string;
  userId: string;
}): Promise<{ error: string | null }> {
  return runPostReimbursement("post", args, "Failed to post reimbursement");
}

export function voidReimbursement(args: {
  reimbursementId: string;
  companyId: string;
  userId: string;
}): Promise<{ error: string | null }> {
  return runPostReimbursement("void", args, "Failed to void reimbursement");
}

/**
 * The line sum must equal the header amount before a reimbursement may post.
 * The server function's `requireLineSum` enforces the same invariant, but the
 * shared spec requires the UI to refuse FIRST, with a readable message and
 * without a server-function round trip.
 *
 * The threshold is `EPSILON`, matching what `requireLineSum` actually uses —
 * NOT the server function's BALANCE_TOLERANCE of 0.01, which governs the
 * journal's debit/credit residual and is a different question. `DocumentLineEditor`
 * uses the same EPSILON, so the editor, this guard and the server function
 * cannot disagree about what "balanced" means.
 */
export function linesBalanceHeader(
  headerAmount: number,
  lineAmounts: number[]
): boolean {
  const total = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  return Math.abs(total - headerAmount) <= EPSILON;
}

export const REIMBURSEMENT_UNBALANCED_MESSAGE =
  "The coding lines must sum to the reimbursement amount before posting";
