// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { table, id } = params;
  if (!table) throw new Error("table is not found");
  if (!id) throw new Error("id is not found");
  const { api } = await authorize(request);
  const result = await api.settings.deleteCustomField({ id });
  return respond(request, result).redirect(path.to.customFieldList(table), {
    message: "Successfully deleted custom field",
    onError: path.to.attributes
  });
}
