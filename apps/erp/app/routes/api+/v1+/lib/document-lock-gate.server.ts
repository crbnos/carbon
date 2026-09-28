// Document-lock gate for the operation dispatch path — the server half of
// `document-lock-rules.ts`, which holds the per-tool tables and explains why
// they exist.
//
// Like the sales-rule gate, it lives here rather than in the service functions:
// service files are re-exported from module barrels that client components
// import, so they cannot reach the server-only lock helpers
// (`checkRevisionLock` imports @carbon/jobs, the approval helpers are
// `@carbon/ee/approvals.server`). The UI routes keep calling the services
// directly and keep their own guards; this gate gives every dispatch caller
// (HTTP v1, MCP, the in-app agent, workflows) the same refusals.
//
// Reads use the service role, scoped to the caller's company, exactly as
// sales-rules-gate does: the question is the document's real status, not what
// the caller's RLS happens to let it see.

import type { ManifestEntry } from "@carbon/api";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  canApproveRequest,
  canCancelRequest,
  getLatestApprovalRequestForDocument
} from "@carbon/ee/approvals.server";
import { ORPCError } from "@orpc/server";
import { checkRevisionLock } from "~/modules/items/items.server";
import { assertMethodOperationIsDraft } from "~/modules/items/items.service";
import {
  evaluateDocumentLocks,
  hasDocumentLock,
  type LockReader,
  type Row
} from "./document-lock-rules";

type GateContext = { companyId: string; userId: string };

/** The production reader: service role, every read scoped to `companyId`. */
export function createLockReader(context: GateContext): LockReader {
  const serviceRole = getCarbonServiceRole();
  // The table names come from the gate's own static tables, never from the
  // caller, so the untyped `from` is safe.
  const untyped = serviceRole as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        in: (
          column: string,
          values: string[]
        ) => {
          eq: (
            column: string,
            value: string
          ) => PromiseLike<{ data: Row[] | null; error: unknown }>;
        };
      };
    };
  };

  const select: LockReader["select"] = async (
    table,
    columns,
    values,
    column = "id"
  ) => {
    if (values.length === 0) return [];
    const { data, error } = await untyped
      .from(table)
      .select(columns.join(", "))
      .in(column, values)
      .eq("companyId", context.companyId);
    if (error) {
      // Fail closed with a message: the write must not run unchecked, and a
      // raw PostgREST error object would surface as an unmapped failure.
      const detail =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Could not check whether this ${table} is locked: ${detail}`
      });
    }
    return data ?? [];
  };

  return {
    select,
    revisionLock(kind, id) {
      return checkRevisionLock(serviceRole, {
        kind,
        id,
        companyId: context.companyId
      });
    },
    async methodOperationDraftError(operationId) {
      // The operation id was resolved through a company-scoped read, or came
      // straight from the payload; confirm it is the caller's before asking.
      const owned = await select("methodOperation", ["id"], [operationId]);
      if (owned.length === 0) return null;
      try {
        await assertMethodOperationIsDraft(serviceRole, operationId);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    async purchaseOrderApproval(purchaseOrderId) {
      const request = await getLatestApprovalRequestForDocument(
        serviceRole,
        "purchaseOrder",
        purchaseOrderId
      );
      const data = request.data;
      if (
        !data ||
        data.status !== "Pending" ||
        !data.requestedBy ||
        data.companyId !== context.companyId
      ) {
        return null;
      }
      const isRequester = canCancelRequest(
        { requestedBy: data.requestedBy, status: "Pending" },
        context.userId
      );
      const isApprover = await canApproveRequest(
        serviceRole,
        {
          amount: data.amount,
          documentType: data.documentType,
          companyId: data.companyId
        },
        context.userId
      );
      return { isRequester, isApprover };
    }
  };
}

/**
 * Refuse a dispatch the UI would refuse on a locked document. Returns the
 * route's message, or null when the operation may proceed; operations with no
 * lock entry return null without touching the database.
 */
export async function checkDocumentLocksForOperation(
  meta: ManifestEntry,
  context: GateContext,
  functionArgs: unknown[]
): Promise<string | null> {
  if (!hasDocumentLock(meta.name)) return null;
  return evaluateDocumentLocks(meta, functionArgs, createLockReader(context));
}
