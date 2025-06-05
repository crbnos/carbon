import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import { activateMethodVersion } from "~/modules/items/items.service";
import { requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const url = new URL(request.url);
  const methodToReplace = url.searchParams.get("methodToReplace");

  const { id } = params;
  if (!id) {
    return json({ success: false, message: "Invalid operation tool id" });
  }

  const update = await activateMethodVersion(getCarbonServiceRole(), {
    id,
    companyId,
    userId,
  });

  if (update.error) {
    return json({
      success: false,
      message: "Failed to activate method version",
    });
  }

  if (!methodToReplace) {
    return json({
      success: false,
      message: "Method to replace is required",
    });
  }

  const redirectPath = requestReferrer(request)?.replace(
    methodToReplace ?? "",
    id ?? ""
  );

  if (!redirectPath) {
    return json({
      success: false,
      message: "Failed to redirect to the correct page",
    });
  }

  return redirect(redirectPath);
}
