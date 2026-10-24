// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderJobTravelerPdf } from "~/modules/production/production.pdf";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find job id");

  const { body, fileName } = await renderJobTravelerPdf(
    await getCarbonServiceRole(),
    { companyId, jobId, locale: getPreferenceHeaders(request).locale }
  );

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`
    })
  });
}
