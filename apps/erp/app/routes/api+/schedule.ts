import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { runLocationSchedule } from "@carbon/ee/planning";
import type { ActionFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");

  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  if (!locationId) {
    return { success: false, error: "A location is required to regenerate" };
  }

  // Regenerate the whole location's forecast IN-PROCESS (Node) rather than
  // round-tripping to the `schedule` edge function — no cold start, no HTTP hop.
  // Awaited before we return, so the fetcher's revalidation reads fully-
  // committed reservations. Service-role client matches the privileged execution
  // the edge function did internally; the route's requirePermissions is the gate.
  try {
    const result = await runLocationSchedule({
      db: getDatabaseClient(),
      client: getCarbonServiceRole(),
      locationId,
      companyId,
      userId
    });
    return { success: true, error: null, ...result };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to regenerate schedule"
    };
  }
}
