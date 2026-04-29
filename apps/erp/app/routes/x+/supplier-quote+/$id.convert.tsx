import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  convertSupplierQuoteToOrder,
  getSupplier,
  getSupplierQuote,
  selectedLinesValidator
} from "~/modules/purchasing";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

// the edge function grows larger than 2MB - so this is a workaround to avoid the edge function limit

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const selectedLinesRaw = formData.get("selectedLines") ?? "{}";

  if (typeof selectedLinesRaw !== "string") {
    throw redirect(
      path.to.supplierQuoteDetails(id),
      await flash(request, error("Invalid selected lines data"))
    );
  }

  const parseResult = selectedLinesValidator.safeParse(
    JSON.parse(selectedLinesRaw)
  );

  if (!parseResult.success) {
    console.error("Validation error:", parseResult.error);
    throw redirect(
      path.to.supplierQuoteDetails(id),
      await flash(request, error("Invalid selected lines data"))
    );
  }

  const selectedLines = parseResult.data;

  const serviceRole = getCarbonServiceRole();

  // Check supplier approval status
  const [quote, companySettingsResult] = await Promise.all([
    getSupplierQuote(serviceRole, id),
    getCompanySettings(serviceRole, companyId)
  ]);

  if (companySettingsResult.data?.supplierApproval && quote.data?.supplierId) {
    const supplier = await getSupplier(serviceRole, quote.data.supplierId);
    if (supplier.data?.status !== "Active") {
      throw redirect(
        path.to.supplierQuoteDetails(id),
        await flash(
          request,
          error("Cannot convert to order: supplier is not approved (Active)")
        )
      );
    }
  }

  const convert = await convertSupplierQuoteToOrder(serviceRole, {
    id: id,
    companyId,
    userId,
    selectedLines
  });

  if (convert.error) {
    throw redirect(
      path.to.supplierQuoteDetails(id),
      await flash(
        request,
        error(convert.error, "Failed to convert quote to order")
      )
    );
  }

  throw redirect(
    path.to.purchaseOrder(convert.data?.convertedId!),
    await flash(request, success("Successfully converted quote to order"))
  );
}
