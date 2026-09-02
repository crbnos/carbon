import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateSalesRulesForSalesDocument,
  isBlocked
} from "@carbon/ee/rules.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  calculatePricesForQuantities,
  convertSalesRfqToQuote,
  resolvePurchaseToOrderPrices,
  resolveQuoteLinePrices
} from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const serviceRole = getCarbonServiceRole();

  // Terminal gate before the `convert` edge function mints quote lines. Gating
  // here rather than inside the edge function keeps the evaluator in one place
  // (it is Deno and cannot import the ERP server runtime the plan gate needs).
  const acknowledged =
    (await request.formData()).get("acknowledged") === "true";
  const { violations, ruleNames } = await evaluateSalesRulesForSalesDocument({
    client: serviceRole,
    companyId,
    userId,
    documentType: "salesRfq",
    documentId: id
  });
  const deduped = dedupeViolations(violations);
  // No acknowledgment evidence here: the table's documentType CHECK covers
  // quote / salesOrder / salesInvoice only, and the minted quote's own line
  // checks and finalize/convert gates re-evaluate (and record) everything
  // downstream.
  if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
    return { violations: deduped, ruleNames };
  }

  const convert = await convertSalesRfqToQuote(serviceRole, {
    id,
    companyId,
    userId
  });

  if (convert.error) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(convert.error, "Failed to convert RFQ"))
    );
  }

  const quoteId = convert.data?.convertedId!;

  // Seed `quoteLinePrice` rows for every new line. The convert function
  // creates the `quoteLine` records (and, for Make to Order, kicks off
  // `get-method itemToQuoteLine` to populate methods/materials), but it
  // never writes any prices — so the new quote opens with empty pricing.
  // The standard "add quote line" path in `$quoteId.new.tsx` calls these
  // same helpers per methodType; mirror that here.
  const newLines = await serviceRole
    .from("quoteLine")
    .select("id, methodType, quantity")
    .eq("quoteId", quoteId);

  if (!newLines.error && newLines.data) {
    await Promise.all(
      newLines.data.map((line) => {
        const quantities = line.quantity ?? [1];
        if (quantities.length === 0) return null;

        switch (line.methodType) {
          case "Make to Order":
            return calculatePricesForQuantities(
              serviceRole,
              quoteId,
              line.id,
              quantities,
              userId
            );
          case "Pull from Inventory":
            return resolveQuoteLinePrices(
              serviceRole,
              companyId,
              quoteId,
              line.id,
              quantities,
              userId
            );
          case "Purchase to Order":
            return resolvePurchaseToOrderPrices(
              serviceRole,
              companyId,
              quoteId,
              line.id,
              quantities,
              userId
            );
          default:
            return null;
        }
      })
    );
  }

  throw redirect(
    path.to.quoteDetails(quoteId),
    await flash(request, success("Successfully converted RFQ to quote"))
  );
}
