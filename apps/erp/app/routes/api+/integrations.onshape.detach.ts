// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/** Remove an item's Onshape panel link (`detachOnshapeItem`). */
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const api = await carbon(request);
  const result = await api.settings.detachOnshapeItem({
    itemId: String(formData.get("itemId") ?? "")
  });
  // The Confirm modal toasts `message`.
  return result.error
    ? data(
        { success: false, message: result.error.message },
        { status: result.error.status }
      )
    : data({ success: true, message: "Detached from Onshape" });
}
