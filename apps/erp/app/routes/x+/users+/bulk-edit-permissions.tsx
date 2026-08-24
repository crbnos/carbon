import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { batchTrigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  bulkPermissionsValidator,
  userPermissionsValidator
} from "~/modules/users";
import { getParams, path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "users"
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
