// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The AR and AP aging CSV downloads. The same data is on screen for an
// invoicing viewer (the receivables/payables workbenches) and for an accounting
// viewer (the aging reports), so the download admits either; the page loaders
// keep their own, narrower, permission.

import { requirePermissions } from "@carbon/auth/auth.server";
import { CSV_CONTENT_TYPE, encodeCsvTable } from "@carbon/files/csv";
import { getAgingParams } from "~/modules/invoicing/invoicing.service";

export async function resolveAgingExportRequest(request: Request) {
  const { client, companyId, permissions } = await requirePermissions(request, {
    role: "employee"
  });
  const canView = ["invoicing", "accounting"].some((module) =>
    permissions[module]?.view.includes(companyId)
  );
  if (!canView) throw new Response("Forbidden", { status: 403 });

  const params = await getAgingParams(client, companyId, request);
  return { client, companyId, ...params };
}

export function agingCsvResponse(
  filename: string,
  table: { fields: string[]; rows: unknown[][] }
) {
  return new Response(encodeCsvTable(table.fields, table.rows), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
