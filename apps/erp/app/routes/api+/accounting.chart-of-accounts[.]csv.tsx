// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The chart of accounts import template: the group's current chart as a CSV.

import { requirePermissions } from "@carbon/auth/auth.server";
import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { getAccountImportTemplate } from "~/modules/accounting";
import { ACCOUNT_IMPORT_CSV_COLUMNS } from "~/modules/accounting/account-import-csv";

const logger = getLogger("erp", "api/accounting/chart-of-accounts.csv");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: "accounting" }
  );

  const template = await getAccountImportTemplate(
    client,
    companyGroupId,
    companyId
  );
  if (template.error) {
    logger.error("Failed to build the chart of accounts template", {
      companyId,
      error: template.error
    });
    throw new Response("The chart of accounts could not be exported.", {
      status: 500
    });
  }

  const csv = encodeCsv(template.data, {
    fields: [...ACCOUNT_IMPORT_CSV_COLUMNS]
  });
  return new Response(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": "attachment; filename=chart-of-accounts.csv"
    }
  });
}
