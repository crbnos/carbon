import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { issueTrackedEntityValidator } from "~/services/models";

const log = getLogger("mes");

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
    jobOperationStepId,
    unitNumber,
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
      jobOperationStepId,
      unitNumber,
      overrideExpired,
      overrideReason,
      companyId,
      userId
    }
  });

  if (issue.error) {
    log.error("Failed to issue material", { error: issue.error });
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

  // No label print on issue: the split child is CONSUMED (it departed into the
  // job) and consumed portions get no label; the surviving lineside entity
  // keeps its existing label.

  return {
    success: true,
    message: "Material issued successfully",
    splitEntities,
    warning
  };
}
