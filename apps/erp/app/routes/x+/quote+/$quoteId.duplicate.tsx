import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs} from "@vercel/remix";
import { json } from "@vercel/remix";
import { copyQuote } from "~/modules/sales/sales.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const asRevision = formData.get("asRevision") === "true";
  const quoteId = String(formData.get("quoteId"));

  if (!quoteId)
    return json({
      success: false,
      message: "Invalid form data",
    });

  const serviceRole = await getCarbonServiceRole();

  const copy = await copyQuote(serviceRole, {
    sourceId: quoteId,
    targetId: asRevision ? quoteId : "",
    companyId: companyId,
    userId: userId,
  });

  console.log(copy);

  return json({
    success: true,
    message: "Successfully duplicated quote",
  });
}
