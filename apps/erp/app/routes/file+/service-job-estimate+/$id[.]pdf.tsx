// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderServiceJobEstimatePdf } from "~/modules/service/service.pdf";

/** A service job's estimate as a PDF (`renderServiceJobEstimatePdf`). */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: "service" }
  );
  const { id } = params;
  if (!id) throw new Error("Could not find service job id");

  const rendered = await renderServiceJobEstimatePdf(client, {
    id,
    companyId,
    companyGroupId,
    locale: getPreferenceHeaders(request).locale
  });
  // The renderer logs why it could not read the job.
  if (!rendered) {
    throw new Response("The service job could not be found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${rendered.fileName}"`
  });
  return new Response(new Uint8Array(rendered.pdf), { status: 200, headers });
}
