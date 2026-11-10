// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The default accounts template of the chart of accounts import: one row per
// default role and fixed asset class account, with the account it uses now.

import { requirePermissions } from "@carbon/auth/auth.server";
import { loadAccountImportContext } from "@carbon/database/account-import-reads";
import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import {
  DEFAULT_ACCOUNTS_CSV_COLUMNS,
  defaultAccountsTemplate
} from "~/modules/accounting/account-import-csv";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "api/accounting/default-accounts.csv");

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
    csv = encodeCsv(defaultAccountsTemplate(ctx), {
      fields: [...DEFAULT_ACCOUNTS_CSV_COLUMNS]
    });
  } catch (error) {
    logger.error("Failed to build the default accounts template", {
      companyId,
      error
    });
    throw new Response("The default accounts could not be exported.", {
      status: 500
    });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": "attachment; filename=default-accounts.csv"
    }
  });
}
