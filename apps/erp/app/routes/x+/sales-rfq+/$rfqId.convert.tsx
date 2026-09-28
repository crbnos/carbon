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
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { convertSalesRfqToQuote } from "~/modules/sales";
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

  // Mints the quote and seeds every new line's price rows — the same call
  // `sales_convertSalesRfqToQuote` makes over MCP.
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

  throw redirect(
    path.to.quoteDetails(quoteId),
    await flash(request, success("Successfully converted RFQ to quote"))
  );
}
