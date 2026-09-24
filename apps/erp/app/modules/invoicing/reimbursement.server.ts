import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { EPSILON } from "@carbon/utils";

/**
 * The ONE module the ERP invokes `post-reimbursement` from, so the Post action
 * route and the edit page's `save-and-post` intent cannot drift apart.
 *
 * Deliberately NOT re-exported from `apps/erp/app/modules/invoicing/index.ts`:
 * that barrel is imported by client components, and a `.server` module that
 * reaches the client graph fails the React Router build.
 */
async function invokePostReimbursement(
  type: "post" | "void",
  args: { reimbursementId: string; companyId: string; userId: string },
  fallbackMessage: string
): Promise<{ error: string | null }> {
  const serviceRole = getCarbonServiceRole();
  try {
    const result = await serviceRole.functions.invoke("post-reimbursement", {
      body: {
        type,
        reimbursementId: args.reimbursementId,
        userId: args.userId,
        companyId: args.companyId
      }
    });
    if (result.error) {
      // A Supabase edge function puts its useful text in the BODY, not in
      // `error.message` — unwrap it so the flash names the real refusal.
      return {
        error:
          (result.data as { message?: string } | undefined)?.message ??
          result.error.message ??
          fallbackMessage
      };
    }
  } catch (err) {
    return { error: (err as Error).message ?? fallbackMessage };
  }

  return { error: null };
}

export function postReimbursement(args: {
  reimbursementId: string;
  companyId: string;
  userId: string;
}): Promise<{ error: string | null }> {
  return invokePostReimbursement("post", args, "Failed to post reimbursement");
}

export function voidReimbursement(args: {
  reimbursementId: string;
  companyId: string;
  userId: string;
}): Promise<{ error: string | null }> {
  return invokePostReimbursement("void", args, "Failed to void reimbursement");
}

/**
 * The line sum must equal the header amount before a reimbursement may post.
 * The edge function's `requireLineSum` enforces the same invariant, but the
 * shared spec requires the UI to refuse FIRST, with a readable message and
 * without an edge-function round trip.
 *
 * The threshold is `EPSILON`, matching what `requireLineSum` actually uses —
 * NOT the edge function's BALANCE_TOLERANCE of 0.01, which governs the
 * journal's debit/credit residual and is a different question. `DocumentLineEditor`
 * uses the same EPSILON, so the editor, this guard and the edge function
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
