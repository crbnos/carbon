// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateSalesRulesForSalesDocument,
  isBlocked
} from "@carbon/ee/rules.server";
import type { Violation } from "@carbon/utils";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  calculatePricesForQuantities,
  convertSalesRfqToQuote,
  resolvePurchaseToOrderPrices,
  resolveQuoteLinePrices
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const serviceRole = getCarbonServiceRole();

  // Terminal gate before the `convert` server function mints quote lines. Gating
  // here rather than inside the server function keeps the evaluator in one place
  // (the plan gate needs the ERP server runtime).
  const acknowledged =
    (await request.formData()).get("acknowledged") === "true";
  let violations: Violation[];
  let ruleNames: Record<string, string>;
  try {
    const result = await evaluateSalesRulesForSalesDocument({
      client: serviceRole,
      companyId,
      userId,
      documentType: "salesRfq",
      documentId: id
    });
    violations = result.violations;
    ruleNames = result.ruleNames;
  } catch (err) {
    // Fail closed but not as a raw 500 — the modal shows the message.
    return {
      violations: [
        {
          ruleId: "__evaluation-error__",
          severity: "error" as const,
          message:
            err instanceof Error ? err.message : "Sales rule evaluation failed"
        }
      ],
      ruleNames: {}
    };
  }
  const deduped = dedupeViolations(violations);
  // No acknowledgment evidence here: the table's documentType CHECK covers
  // quote / salesOrder / salesInvoice only, and the minted quote's own line
  // checks and finalize/convert gates re-evaluate (and record) everything
  // downstream.
  if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
    return { violations: deduped, ruleNames };
  }

  const convert = await convertSalesRfqToQuote(
    serviceRole,
    getDatabaseClient(),
    {
      id,
      companyId,
      userId
    }
  );

  if (convert.error) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(convert.error, "Failed to convert RFQ"))
    );
  }

  const quoteId = convert.data?.convertedId!;

  // Seed `quoteLinePrice` rows for the new lines that have none, so the quote
  // does not open with empty pricing. A Make to Order line whose method was
  // copied (`get-method itemToQuoteLine`) is priced already; seeding it again
  // was a duplicate insert the database refused. The "add quote line" path in
  // `$quoteId.new.tsx` calls these same helpers per methodType.
  const [newLines, priced] = await Promise.all([
    serviceRole
      .from("quoteLine")
      .select("id, methodType, quantity")
      .eq("quoteId", quoteId)
      .eq("companyId", companyId),
    serviceRole
      .from("quoteLinePrice")
      .select("quoteLineId")
      .eq("quoteId", quoteId)
      .eq("companyId", companyId)
  ]);
  const pricedLineIds = new Set(priced.data?.map((p) => p.quoteLineId));

  if (!newLines.error && newLines.data) {
    await Promise.all(
      newLines.data
        .filter((line) => !pricedLineIds.has(line.id))
        .map((line) => {
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
