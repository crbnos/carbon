import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { activateMethodVersion } from "~/modules/items/items.service";
import { requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "parts"
  });

  const url = new URL(request.url);
  const methodToReplace = url.searchParams.get("methodToReplace");

  const { id } = params;
  if (!id) {
    return { success: false, message: "Invalid operation tool id" };
  }

  const update = await activateMethodVersion({ id });

  if (update.error) {
    return {
      success: false,
      message: "Failed to activate method version"
    };
  }

  if (!methodToReplace) {
    return {
      success: false,
      message: "Method to replace is required"
    };
  }

  const redirectPath = requestReferrer(request)?.replace(
    methodToReplace ?? "",
    id ?? ""
  );

  if (!redirectPath) {
    return {
      success: false,
      message: "Failed to redirect to the correct page"
    };
  }

  return redirect(redirectPath);
}
