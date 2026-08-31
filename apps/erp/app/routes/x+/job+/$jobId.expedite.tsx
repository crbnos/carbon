import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getJobExpediteForecast } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // Read-only "best case" what-if — no writes happen, so view is sufficient.
  const { companyId, userId } = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const expedite = await getJobExpediteForecast(
    getCarbonServiceRole(),
    jobId,
    companyId,
    userId
  );

  if (expedite.error) {
    return data(
      { expedite: null },
      await flash(
        request,
        error(expedite.error, "Failed to compute best case forecast")
      )
    );
  }

  return data({ expedite: expedite.data });
}
