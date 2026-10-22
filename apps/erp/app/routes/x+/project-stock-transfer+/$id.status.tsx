// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  type ProjectStockTransferAction,
  projectStockTransferActions
} from "~/modules/projects/projects.models";
import { path, requestReferrer } from "~/utils/path";

const successMessages: Record<ProjectStockTransferAction, string> = {
  approve: "Transfer approved",
  post: "Transfer posted",
  cancel: "Transfer cancelled"
};

/**
 * Approve (Draft), Post (Approved) or Cancel (Draft or Approved) a project
 * stock transfer; each needs `update: projects`. A refusal, such as the
 * government-furnished guard or too little stock, shows as a flash error.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const back = requestReferrer(request) ?? path.to.projectStockTransfer(id);
  const action = (await request.formData()).get("action");
  if (
    !projectStockTransferActions.includes(action as ProjectStockTransferAction)
  ) {
    throw redirect(back, await flash(request, error(null, "Invalid action")));
  }
  const transferAction = action as ProjectStockTransferAction;

  const api = await carbon(request);
  const result = await api.projects.updateProjectStockTransferStatus({
    id,
    action: transferAction
  });

  if (result.error) {
    // A refusal reads as its own message (the government-furnished guard,
    // too little stock).
    const message =
      result.error.category === "internal" && transferAction === "post"
        ? "Failed to post the transfer"
        : result.error.message;
    throw redirect(back, await flash(request, error(null, message)));
  }

  throw redirect(
    back,
    await flash(request, success(successMessages[transferAction]))
  );
}
