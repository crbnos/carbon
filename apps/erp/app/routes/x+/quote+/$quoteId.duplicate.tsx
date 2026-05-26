import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { copyQuote } from "~/modules/sales/sales.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { quoteId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const asRevision = formData.get("asRevision") === "true";
  const quoteId = String(formData.get("quoteId"));

  if (!quoteId)
    return {
      success: false,
      message: "Invalid form data"
    };

  // @ts-expect-error TS2345 - TODO: fix type
  const copy = await copyQuote({
    sourceId: quoteId,
    targetId: asRevision ? quoteId : "",
    companyId: companyId,
    userId: userId
  });

  if (copy.error) {
    return {
      success: false,
      message: "Failed to duplicate quote"
    };
  }

  return {
    success: true,
    data: {
      newQuoteId: copy.data?.newQuoteId
    }
  };
}
