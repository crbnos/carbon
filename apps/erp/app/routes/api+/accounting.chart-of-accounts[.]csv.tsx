// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The chart template of the chart of accounts import: the group's current
// chart in the columns the import reads.

import { requirePermissions } from "@carbon/auth/auth.server";
import { loadAccountImportContext } from "@carbon/database/account-import-reads";
import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import {
  CHART_CSV_COLUMNS,
  chartTemplate
} from "~/modules/accounting/account-import-csv";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "api/accounting/chart-of-accounts.csv");

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, companyGroupId } = await requirePermissions(request, {
    view: "accounting"
  });

  let csv: string;
  try {
    const ctx = await loadAccountImportContext(
      getDatabaseClient(),
      companyGroupId,
      companyId
    );
    csv = encodeCsv(chartTemplate(ctx), { fields: [...CHART_CSV_COLUMNS] });
  } catch (error) {
    logger.error("Failed to build the chart of accounts template", {
      companyId,
      error
    });
    throw new Response("The chart of accounts could not be exported.", {
      status: 500
    });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": "attachment; filename=chart-of-accounts.csv"
    }
  });
}
