// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { api } = await authorize(request);

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const result = await api.accounting.reverseJournalEntry({
    id: journalEntryId,
    data: {}
  });

  return respond(request, result).redirect(
    path.to.journalEntryDetails(journalEntryId),
    {
      message: "Journal entry reversed",
      onError: path.to.journalEntryDetails(journalEntryId)
    }
  );
}
