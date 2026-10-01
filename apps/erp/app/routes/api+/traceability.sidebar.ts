// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { fetchJobStepRecords } from "~/modules/inventory/lineage.server";
import type { StepRecord } from "~/modules/inventory/ui/Traceability/utils";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true
  });

  const url = new URL(request.url);
  const activityId = url.searchParams.get("activityId");

  if (!activityId) {
    return Response.json({ stepRecords: [] as StepRecord[] });
  }

  const activityRes = await client
    .from("trackedActivity")
    .select("attributes")
    .eq("id", activityId)
    .eq("companyId", companyId)
    .maybeSingle();

  const jobId = (activityRes.data?.attributes as Record<string, unknown> | null)
    ?.Job;

  if (typeof jobId !== "string" || !jobId) {
    return Response.json({ stepRecords: [] as StepRecord[] });
  }

  // The step records RPC filters on the job id alone and `client` is the
  // service role, so the job must be this company's too.
  const jobRes = await client
    .from("job")
    .select("id")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!jobRes.data) {
    return Response.json({ stepRecords: [] as StepRecord[] });
  }

  const stepRecords = await fetchJobStepRecords(client, jobId, companyId);
  return Response.json({ stepRecords });
}
