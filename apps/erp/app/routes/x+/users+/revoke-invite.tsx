import { CarbonEdition, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { deactivateUser } from "@carbon/auth/users.server";
import { validationError, validator } from "@carbon/form";
import { batchTrigger } from "@carbon/jobs";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { revokeInviteValidator } from "~/modules/users";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    create: "users"
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
    return data(
      { success: false },
      await flash(
        request,
        error(usersToRevoke.error.message, "Failed to load users")
      )
    );
  }

  if (usersToRevoke.data.length == 1) {
    const deactivate = await deactivateUser(
      serviceRole,
      usersToRevoke.data[0].id,
      companyId
    );
    if (!deactivate.success) {
      return data(
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
        companyId
      }
    }));

    await batchTrigger("user-admin", batchPayload);
  }

  const revokeInvites = await serviceRole
    .from("invite")
    .update({ revokedAt: new Date().toISOString() })
    .in(
      "email",
      usersToRevoke.data.map((user) => user.email)
    )
    .eq("companyId", companyId)
    .is("revokedAt", null);

  if (revokeInvites.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(revokeInvites.error.message, "Failed to revoke invites")
      )
    );
  }

  return data(
    {},
    await flash(request, success("Successfully revoked invites"))
  );
}
