import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { issueTrackedEntityValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const payload = await request.json();
  const validation = issueTrackedEntityValidator.safeParse(payload);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const {
    materialId,
    jobOperationId,
    itemId,
    parentTrackedEntityId,
    children,
    overrideExpired,
    overrideReason
  } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      type: "trackedEntitiesToOperation",
      materialId,
      jobOperationId,
      itemId,
      parentTrackedEntityId,
      children,
      overrideExpired,
      overrideReason,
      companyId,
      userId
    }
  });

  if (issue.error) {
    console.error(issue.error);
    // Supabase wraps non-2xx edge-fn responses in FunctionsHttpError where
    // the actual body lives on `context`. Try to pull our { message } out;
    // fall back to the wrapper's own message if parsing fails.
    let message = "Failed to issue material";
    const ctx = (issue.error as { context?: Response })?.context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.clone().json();
        if (body && typeof body.message === "string") {
          message = body.message;
        }
      } catch {
        /* fall through to default */
      }
    } else if ((issue.error as { message?: string }).message) {
      message = (issue.error as { message: string }).message;
    }
    return data({ success: false, message }, { status: 400 });
  }

  const splitEntities = issue.data?.splitEntities || [];
  const warning = issue.data?.warning as string | undefined;

  // Auto-print labels for split entities
  if (splitEntities.length > 0) {
    try {
      let locationId: string | undefined;
      let workCenterId: string | undefined;
      if (jobOperationId) {
        const { data: op } = await serviceRole
          .from("jobOperation")
          .select("workCenterId")
          .eq("id", jobOperationId)
          .single();
        workCenterId = op?.workCenterId ?? undefined;
      }
      if (workCenterId) {
        const { data: wc } = await serviceRole
          .from("workCenter")
          .select("locationId")
          .eq("id", workCenterId)
          .single();
        locationId = wc?.locationId ?? undefined;
      }

      for (const split of splitEntities) {
        await trigger("print-job", {
          sourceDocument: "Split",
          sourceDocumentId: split.newId,
          companyId,
          userId,
          locationId,
          workCenterId
        });
      }
    } catch (e) {
      console.error("Auto-print for split entities failed:", e);
    }
  }

  return {
    success: true,
    message: "Material issued successfully",
    splitEntities,
    warning
  };
}
