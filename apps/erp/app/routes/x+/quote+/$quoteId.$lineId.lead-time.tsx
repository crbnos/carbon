import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { runQuoteLeadTimeWhatIf } from "@carbon/planning";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { quoteLeadTimeValidator } from "~/modules/sales";
import { getUserDefaults } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "quoteid-lineid-lead-time");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // Read-only capable-to-promise what-if — nothing is persisted, so `view` is
  // sufficient (same reasoning as $jobId.expedite.tsx).
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const parsed = quoteLeadTimeValidator.safeParse(await request.json());
  if (!parsed.success) {
    return data({ forecast: null, error: "Invalid request" }, { status: 400 });
  }

  // Re-read the quote AND line under companyId before trusting the URL ids —
  // the record-id rule from workflow-edge-function.md §5 applies to routes too.
  const quote = await client
    .from("quote")
    .select("locationId")
    .eq("id", quoteId)
    .eq("companyId", companyId)
    .single();
  if (quote.error || !quote.data) {
    throw new Response(null, { status: 404 });
  }

  const line = await client
    .from("quoteLine")
    .select("id")
    .eq("id", lineId)
    .eq("quoteId", quoteId)
    .eq("companyId", companyId)
    .single();
  if (line.error || !line.data) {
    throw new Response(null, { status: 404 });
  }

  const locationId =
    quote.data.locationId ??
    (await getUserDefaults(client, userId, companyId)).data?.locationId;
  if (!locationId) {
    return data({
      forecast: null,
      error: "Set a location on the quote to predict lead time"
    });
  }

  try {
    const forecast = await runQuoteLeadTimeWhatIf({
      db: getDatabaseClient(),
      client: getCarbonServiceRole(),
      companyId,
      userId,
      locationId,
      quoteLineId: lineId,
      quantities: parsed.data.quantities,
      dueDate: parsed.data.dueDate
    });
    return data({ forecast, error: null });
  } catch (err) {
    logger.error("Failed to predict quote lead time", { error: err });
    return data({ forecast: null, error: "Failed to predict lead time" });
  }
}
