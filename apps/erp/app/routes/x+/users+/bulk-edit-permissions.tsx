// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getClientIp, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  bulkPermissionsAllMatchingValidator,
  bulkPermissionsValidator,
  userPermissionsValidator
} from "~/modules/users";
import { queuePermissionUpdates } from "~/modules/users/users.server";
import { getParams, path } from "~/utils/path";
import { parseAllMatching } from "~/utils/table-jobs";
import { startTableBulkAction } from "~/utils/table-jobs.server";

const logger = getLogger("erp", "users-bulk-edit-permissions");

type ModulePermissions = Record<
  string,
  { view: boolean; create: boolean; update: boolean; delete: boolean }
>;

/** The form's permissions JSON, or null when it is not valid. */
function parsePermissions(json: string): ModulePermissions | null {
  let permissions: unknown;
  try {
    permissions = JSON.parse(json);
  } catch {
    return null;
  }
  if (permissions === null || typeof permissions !== "object") return null;
  return Object.values(permissions).every(
    (permission) => userPermissionsValidator.safeParse(permission).success
  )
    ? (permissions as ModulePermissions)
    : null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "users"
  });

  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.employeeAccounts,
    feature: "PERMISSIONS"
  });

  const formData = await request.formData();

  // Every matching user of the Employees list: the background job picks the
  // active users and queues their permission update.
  const allMatching = parseAllMatching(formData.get("allMatching"));
  if (allMatching) {
    const matching = await validator(
      bulkPermissionsAllMatchingValidator
    ).validate(formData);
    if (matching.error) {
      return validationError(matching.error);
    }
    const permissions = parsePermissions(matching.data.data);
    if (!permissions) {
      return data({ success: false, message: "Failed to parse permissions" });
    }
    const ip = getClientIp(request) ?? undefined;
    const started = await startTableBulkAction({
      companyId,
      userId,
      actionKey: "users.permissions",
      params: {
        permissions,
        addOnly: matching.data.editType === "add",
        ...(ip ? { ip } : {})
      },
      allMatching
    });
    return started;
  }

  const validation = await validator(bulkPermissionsValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { editType, userIds } = validation.data;
  const addOnly = editType === "add";
  const permissions = parsePermissions(validation.data.data);

  if (!permissions) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(
        request,
        error(validation.data.data, "Failed to parse permissions")
      )
    );
  }

  // The job writes these users' grants as the service role: every id must be
  // an employee of this company. One batched read.
  const uniqueUserIds = [...new Set(userIds)];
  const members = await getCarbonServiceRole()
    .from("employee")
    .select("id")
    .in("id", uniqueUserIds)
    .eq("companyId", companyId);
  if (members.error || (members.data ?? []).length !== uniqueUserIds.length) {
    logger.error("Bulk permission edit names users outside the company", {
      companyId,
      userIds: uniqueUserIds,
      error: members.error
    });
    throw redirect(
      path.to.employeeAccounts,
      await flash(request, error(members.error, "Employee not found"))
    );
  }

  const ip = getClientIp(request) ?? undefined;

  await queuePermissionUpdates({
    userIds,
    companyId,
    actorId: userId,
    permissions,
    addOnly,
    ip
  });

  throw redirect(
    `${path.to.employeeAccounts}?${getParams(request)}`,
    await flash(request, success("Updating user permissions"))
  );
}
