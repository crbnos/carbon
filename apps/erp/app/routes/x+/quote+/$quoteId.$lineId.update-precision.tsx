import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateQuoteLinePrecision } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "quoteid-lineid-update-precision");

const SUPPORTED_PRECISIONS = [2, 3, 4];

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const precision = Number(formData.get("precision") ?? 2);

  if (!SUPPORTED_PRECISIONS.includes(precision)) {
    return data(
      { data: null, error: `Precision must be one of ${SUPPORTED_PRECISIONS}` },
      { status: 400 }
    );
  }

  try {
    await updateQuoteLinePrecision(
      getDatabaseClient(),
      companyId,
      quoteId,
      lineId,
      precision
    );
  } catch (err) {
    logger.error("Failed to update quote line precision", {
      error: err,
      quoteId,
      lineId
    });
    return data(
      { data: null, error: "Failed to update quote line precision" },
      { status: 400 }
    );
  }

  return { data: null, error: null };
}
