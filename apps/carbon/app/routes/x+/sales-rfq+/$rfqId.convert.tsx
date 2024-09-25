import { getCarbonServiceRole } from "@carbon/auth";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { convertSalesRfqToQuote } from "~/modules/sales";
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

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const serviceRole = getCarbonServiceRole();
  const convert = await convertSalesRfqToQuote(serviceRole, {
    id,
    companyId,
    userId,
  });

  if (convert.error) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(convert.error, "Failed to convert RFQ"))
    );
  }

  throw redirect(
    path.to.quoteDetails(convert.data?.convertedId!),
    await flash(request, success("Successfully converted RFQ to quote"))
  );
}
