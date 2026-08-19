import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import type { ActionFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { getCompanySettings } from "~/services/inventory.service";
import { isPickingListLocked, pickingListStatus } from "~/services/models";
import {
  getUnresolvedPickingListLines,
  updatePickingListStatus
} from "~/services/picking.service";

type PickingListStatus = (typeof pickingListStatus)[number];

export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const pickingListId = params.pickingListId;
  const formData = await request.formData();
  const status = formData.get("status") as string;

  if (!pickingListId) {
    return { success: false, message: "Missing pickingListId" };
  }
  if (!pickingListStatus.includes(status as PickingListStatus)) {
    return { success: false, message: "Invalid status" };
  }

  // Reopening a closed picking list is ERP-only — MES may not unlock one.
  const current = await serviceRole
    .from("pickingList")
    .select("status")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .single();
  if (
    isPickingListLocked(current.data?.status) &&
    !isPickingListLocked(status)
  ) {
    return {
      success: false,
      message: "Reopen this picking list from the ERP."
    };
  }

  // Finishing a list must not silently complete with material still unpicked.
  // Enforce the company policy server-side and pick the terminal status:
  // fully picked → Completed, any shortfall → Partial.
  if (status === "Completed") {
    const [lineResult, settings] = await Promise.all([
      getUnresolvedPickingListLines(serviceRole, pickingListId, companyId),
      getCompanySettings(serviceRole, companyId)
    ]);

    if (lineResult.error) {
      return {
        success: false,
        message: "Failed to check picking list lines"
      };
    }

    // Fail closed: if the policy can't be read, don't silently fall back to
    // 'warn' (which an `acknowledged=true` submit could bypass). Refuse the
    // finish instead.
    if (settings.error || !settings.data) {
      return {
        success: false,
        message: "Failed to read the picking list completion policy"
      };
    }

    const policy =
      settings.data.incompletePickingListPolicy === "error" ? "error" : "warn";
    const { unresolved, hasShort } = lineResult;
    const acknowledged = formData.get("acknowledged") === "true";

    if (unresolved.length > 0) {
      if (policy === "error") {
        return {
          success: false,
          blocked: true,
          unresolvedLines: unresolved,
          message: "Some material is still unpicked."
        };
      }
      if (!acknowledged) {
        return {
          success: false,
          needsAcknowledgement: true,
          unresolvedLines: unresolved
        };
      }
    }

    const finalStatus: PickingListStatus =
      unresolved.length === 0 && !hasShort ? "Completed" : "Partial";

    const finishResult = await updatePickingListStatus(
      serviceRole,
      pickingListId,
      finalStatus,
      effectiveUserId,
      companyId
    );

    if (finishResult.error) {
      return {
        success: false,
        message: "Failed to update picking list status"
      };
    }

    // Discriminated on the status for the same reason as the ERP route: a list
    // that goes Partial and later Completed must produce two events.
    trackWorkEvent(
      "picking_list_completed",
      {
        companyId,
        userId: effectiveUserId,
        pickingListId,
        finalStatus: finalStatus,
        source: "mes"
      },
      { discriminator: finalStatus }
    );

    return { success: true };
  }

  const result = await updatePickingListStatus(
    serviceRole,
    pickingListId,
    status as PickingListStatus,
    effectiveUserId,
    companyId
  );

  if (result.error) {
    return { success: false, message: "Failed to update picking list status" };
  }

  return { success: true };
}
