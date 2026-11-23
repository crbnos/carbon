// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// Action-only route: the delete confirmation modal posts here.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["memoId"] });
  if ("invalid" in input) return input.invalid;
  const { memoId } = input.params;
  const api = await carbon(args.request);
  const result = await api.invoicing.deleteDraftMemo({ memoId });
  // Back to the memo's own list: supplier memos are Supplier Credits (AP),
  // customer memos Credit Memos (AR).
  return respond(args.request, result).redirect(
    !result.data
      ? path.to.memo(memoId)
      : result.data.party === "supplier"
        ? path.to.supplierCredits
        : path.to.creditMemos,
    { message: "Successfully deleted memo" }
  );
}
