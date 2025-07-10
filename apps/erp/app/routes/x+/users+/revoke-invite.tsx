import {
  CarbonEdition,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { deactivateUser } from "@carbon/auth/users.server";
import { validationError, validator } from "@carbon/form";
import type { userAdminTask } from "@carbon/jobs/trigger/user-admin";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { revokeInviteValidator } from "~/modules/users";

export const config = { runtime: "nodejs" };

export async function action({ request }: ActionFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    create: "users",
  });

  const validation = await validator(revokeInviteValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { users } = validation.data;

  const serviceRole = getCarbonServiceRole();

  const usersToRevoke = await serviceRole
    .from("user")
    .select("id, email")
    .in("id", users);

  if (usersToRevoke.error) {
    return json(
      { success: false },
      await flash(
        request,
        error(usersToRevoke.error.message, "Failed to load users")
      )
    );
  }

  if (usersToRevoke.data.length == 1) {
    const deactivate = await deactivateUser(serviceRole, users[0], companyId);
    if (!deactivate.success) {
      return json(
        {},
        await flash(
          request,
          error(deactivate.message, "Failed to deactivate user")
        )
      );
    } else if (CarbonEdition === Edition.Cloud) {
      await updateSubscriptionQuantityForCompany(companyId);
    }
  } else {
    const batchPayload = users.map((id) => ({
      payload: {
        id,
        type: "deactivate" as const,
        companyId,
      },
    }));

    await tasks.batchTrigger<typeof userAdminTask>("user-admin", batchPayload);
  }

  const deleteInvites = await serviceRole
    .from("invite")
    .delete()
    .in(
      "email",
      usersToRevoke.data.map((user) => user.email)
    )
    .eq("companyId", companyId);

  if (deleteInvites.error) {
    return json(
      { success: false },
      await flash(
        request,
        error(deleteInvites.error.message, "Failed to revoke invites")
      )
    );
  }

  return json(
    {},
    await flash(request, success("Successfully revoked invites"))
  );
}
