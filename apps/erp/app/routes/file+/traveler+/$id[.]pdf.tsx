// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderJobTravelerPdf } from "~/modules/production/production.pdf";
import { getJobMakeMethodById } from "~/modules/production/production.service";

const logger = getLogger("erp", "traveler", "pdf");

/** One make method's page of the job traveler (the MES operation link). */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const { id } = params;
  if (!id) throw new Error("Could not find job make method id");

  const serviceRole = await getCarbonServiceRole();
  // Scoped by companyId, so a make method of another company is not found,
  // while operators with no permissions can still download the traveler.
  const jobMakeMethod = await getJobMakeMethodById(serviceRole, id, companyId);
  if (jobMakeMethod.error || !jobMakeMethod.data?.jobId) {
    logger.error("Failed to load jobMakeMethod", {
      error: jobMakeMethod.error
    });
    throw new Error("Failed to load job make method");
  }

  const { body, fileName } = await renderJobTravelerPdf(serviceRole, {
    companyId,
    jobId: jobMakeMethod.data.jobId,
    jobMakeMethodId: id,
    locale: getPreferenceHeaders(request).locale
  });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`
    })
  });
}
