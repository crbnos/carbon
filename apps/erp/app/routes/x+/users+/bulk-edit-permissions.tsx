// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { bulkPermissionsValidator } from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";
import { getParams, path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(bulkPermissionsValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { editType, userIds, data } = input.data;
  const api = await carbon(args.request);
  const result = await api.users.bulkUpdatePermissions({
    editType,
    userIds,
    permissions: JSON.parse(data),
    ip: originOf(args.request).ip
  });
  return respond(args.request, result).redirect(
    `${path.to.employeeAccounts}?${getParams(args.request)}`,
    { message: "Updating user permissions", onError: path.to.employeeAccounts }
  );
}
