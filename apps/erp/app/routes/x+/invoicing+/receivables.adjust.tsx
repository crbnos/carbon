// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { path } from "~/utils/path";

const adjustForm = z.object({ asOfDate: zfd.text(z.string().optional()) });

// The new Draft journal entry opens in the editor, to review and post.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(adjustForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.invoicing.receivables.adjust(input.data);
  if (!result.data) {
    return redirectWithResult(args.request, result, {
      to: path.to.receivables
    });
  }
  // A warning: the Draft entry exists but its lines are missing.
  const { journalId, warning } = result.data;
  return redirectWithResult(
    args.request,
    { error: warning ? { message: warning } : null },
    { to: path.to.journalEntryDetails(journalId) }
  );
}
