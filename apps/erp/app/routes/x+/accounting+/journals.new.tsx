// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "journals-new");

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const journalEntry = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("create", { type: "journalEntry" });

  if (!journalEntry.data || journalEntry.error) {
    logger.error(journalEntry.error);
    throw redirect(
      path.to.accountingJournals,
      await flash(
        request,
        error(journalEntry.error, "Failed to create journal entry")
      )
    );
  }

  throw redirect(path.to.journalEntryDetails(String(journalEntry.data.id)));
}
