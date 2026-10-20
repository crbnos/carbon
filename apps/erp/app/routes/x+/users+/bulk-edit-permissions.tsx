// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  bulkPermissionsAllMatchingValidator,
  bulkPermissionsValidator,
  userPermissionsValidator
} from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";
import { getParams, path } from "~/utils/path";
import { parseAllMatching } from "~/utils/table-jobs";
import { startTableBulkAction } from "~/utils/table-jobs.server";

const modulePermissions = z.record(z.string(), userPermissionsValidator);

export async function action(args: ActionFunctionArgs) {
  // Every matching user of the Employees list: the background job picks the
  // active users and queues their permission update. The job checks the
  // PERMISSIONS feature (`canRunBulkAction`).
  const allMatching = parseAllMatching(
    (await args.request.clone().formData()).get("allMatching")
  );
  if (allMatching) {
    const { companyId, userId } = await requirePermissions(args.request, {
      update: "users"
    });
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
    const permissions = modulePermissions.safeParse(parsed);
    if (!permissions.success) {
      return { success: false, message: "Failed to parse permissions" };
    }
    const { ip } = originOf(args.request);
    return startTableBulkAction({
      companyId,
      userId,
      actionKey: "users.permissions",
      params: {
        permissions: permissions.data,
        addOnly: input.data.editType === "add",
        ...(ip ? { ip } : {})
      },
      allMatching
    });
  }

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
