// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { escalateReturnOrderLine } from "~/modules/sales/sales.server";
import { path, requestReferrer } from "~/utils/path";

const dispositionForm = escalateReturnOrderLine.input.pick({
  disposition: true
});

// Escalate an RMA line to a quality Issue (NCR): Scrap and Rework are
// quality decisions.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(dispositionForm).request(args, {
    params: ["id", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.escalateReturnOrderLine({
    salesReturnOrderId: id,
    lineId,
    disposition: input.data.disposition
  });
  if (!result.data) {
    return respond(args.request, result).redirect(
      requestReferrer(args.request) ?? path.to.salesReturnOrderLine(id, lineId),
      { message: "" }
    );
  }
  const { issueId, created, warning } = result.data;
  // An Issue the line already had is opened as it is.
  throw redirect(
    path.to.issue(issueId),
    created
      ? await flash(
          args.request,
          warning
            ? error(null, warning)
            : success("Issue created for return line")
        )
      : undefined
  );
}
