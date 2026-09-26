import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { batchTrigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  bulkPermissionsValidator,
  userPermissionsValidator
} from "~/modules/users";
import { getParams, path } from "~/utils/path";

const logger = getLogger("erp", "users-bulk-edit-permissions");

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

  const validation = await validator(bulkPermissionsValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { editType, userIds, data } = validation.data;
  const addOnly = editType === "add";
  const permissions: Record<
    string,
    {
      view: boolean;
      create: boolean;
      update: boolean;
      delete: boolean;
    }
  > = JSON.parse(data);

  if (
    !Object.values(permissions).every(
      (permission) => userPermissionsValidator.safeParse(permission).success
    )
  ) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(request, error(permissions, "Failed to parse permissions"))
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

  const ip = request.headers.get("x-forwarded-for") ?? undefined;

  const batchPayload = userIds.map((id) => ({
    payload: {
      id,
      permissions,
      addOnly,
      companyId,
      actorId: userId,
      ip
    }
  }));

  await batchTrigger("update-permissions", batchPayload);

  throw redirect(
    `${path.to.employeeAccounts}?${getParams(request)}`,
    await flash(request, success("Updating user permissions"))
  );
}
