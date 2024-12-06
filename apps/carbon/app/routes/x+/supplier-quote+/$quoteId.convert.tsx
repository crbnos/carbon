import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { convertQuoteToOrder, selectedLinesValidator } from "~/modules/sales";
import { path } from "~/utils/path";

// the edge function grows larger than 2MB - so this is a workaround to avoid the edge function limit
export const config = {
  runtime: "nodejs",
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const formData = await request.formData();
  const selectedLinesRaw = formData.get("selectedLines") ?? "{}";

  if (typeof selectedLinesRaw !== "string") {
    throw redirect(
      path.to.quoteDetails(quoteId),
      await flash(request, error("Invalid selected lines data"))
    );
  }

  const parseResult = selectedLinesValidator.safeParse(
    JSON.parse(selectedLinesRaw)
  );

  if (!parseResult.success) {
    console.error("Validation error:", parseResult.error);
    throw redirect(
      path.to.quoteDetails(quoteId),
      await flash(request, error("Invalid selected lines data"))
    );
  }

  const selectedLines = parseResult.data;

  const serviceRole = getCarbonServiceRole();
  const convert = await convertQuoteToOrder(serviceRole, {
    id: quoteId,
    companyId,
    userId,
    selectedLines,
  });

  if (convert.error) {
    throw redirect(
      path.to.quoteDetails(quoteId),
      await flash(
        request,
        error(convert.error, "Failed to convert quote to order")
      )
    );
  }

  throw redirect(
    path.to.salesOrder(convert.data?.convertedId!),
    await flash(request, success("Successfully converted quote to order"))
  );
}
