// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.journalEntry.create({});
  return redirectWithResult(args.request, result, {
    to: result.data
      ? path.to.journalEntryDetails(result.data.id)
      : path.to.accountingJournals
  });
}
