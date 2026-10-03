// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deleteJournalEntry } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const result = await deleteJournalEntry(client, journalEntryId);

  if (result.error) {
    throw redirect(
      path.to.journalEntryDetails(journalEntryId),
      await flash(
        request,
        error(result.error, "Failed to delete journal entry")
      )
    );
  }

  throw redirect(
    path.to.accountingJournals,
    await flash(request, success("Journal entry deleted"))
  );
}
