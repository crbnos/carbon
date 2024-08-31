import { type ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "remix-typedjson";
import { getSupabaseServiceRole } from "~/lib/supabase";
import { convertQuoteToOrder, selectedLinesValidator } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const formData = await request.formData();
  const selectedLinesRaw = formData.get("selectedLines");

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

  const serviceRole = getSupabaseServiceRole();
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
