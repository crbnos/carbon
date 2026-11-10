// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  bulkPermissionsAllMatchingValidator,
  bulkPermissionsValidator,
  permissionsValidator
} from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";
import { getParams, path } from "~/utils/path";
import { startBackgroundBulkAction } from "~/utils/table-jobs.server";

// The same grants the per-user edit sends (the access grid's levels).
const bulkGrants = permissionsValidator.shape.grants;

export async function action(args: ActionFunctionArgs) {
  // Every matching user of the Employees list: the background job picks the
  // active users and queues their permission update. The job checks the
  // PERMISSIONS feature (`canRunBulkAction`).
  const allMatching = (await args.request.clone().formData()).get(
    "allMatching"
  );
  if (allMatching) {
    const input = await validator(bulkPermissionsAllMatchingValidator).request(
      args
    );
    if ("invalid" in input) return input.invalid;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(input.data.data);
    } catch {
      parsed = null;
    }
    const grants = bulkGrants.safeParse(parsed);
    if (!grants.success) {
      return { success: false, message: "Failed to parse permissions" };
    }
    const { ip } = originOf(args.request);
    const started = await startBackgroundBulkAction(
      args.request,
      "users.permissions",
      { allMatching },
      {
        grants: grants.data,
        addOnly: input.data.editType === "add",
        ...(ip ? { ip } : {})
      }
    );
    if (started) return started;
  }

  const input = await validator(bulkPermissionsValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { editType, userIds, data } = input.data;
  const { api } = await authorize(args.request);
  const result = await api.users.bulkUpdatePermissions({
    editType,
    userIds,
    grants: JSON.parse(data),
    ip: originOf(args.request).ip
  });
  return respond(args.request, result).redirect(
    `${path.to.employeeAccounts}?${getParams(args.request)}`,
    { message: "Updating user permissions", onError: path.to.employeeAccounts }
  );
}
