// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { path } from "~/utils/path";

const reconcileForm = z.object({ asOfDate: z.string().min(1) });

// Tie-out Reconcile action: drafts an adjusting journal that brings the GL
// inventory accounts to the subledger valuation. The journal is Draft — the
// accountant reviews and posts it from the Journals screen.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(reconcileForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.inventory.createInventoryReconciliationJournal(
    input.data
  );
  // An error is toasted on the workbench.
  if (result.error) return result;
  return respond(args.request, result).redirect(path.to.accountingJournals, {
    message: "Draft reconciliation journal created — review and post it"
  });
}
