import { CarbonEdition, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { deactivateUser } from "@carbon/auth/users.server";
import { insertAuditLogEntries } from "@carbon/database/audit";
import { validationError, validator } from "@carbon/form";
import { batchTrigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { datetime, Edition } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { revokeInviteValidator } from "~/modules/users";

const logger = getLogger("erp", "revoke-invite");

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    create: "users"
  });

  const validation = await validator(revokeInviteValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { users } = validation.data;

  const ip = request.headers.get("x-forwarded-for") ?? undefined;

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
      companyId,
      userId,
      ip
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
        companyId,
        actorId: userId,
        ip
      }
    }));

    await batchTrigger("user-admin", batchPayload);
  }

  const revokedAt = datetime.timestamp();
  const revokeInvites = await serviceRole
    .from("invite")
    .update({ revokedAt })
    .in(
      "email",
      usersToRevoke.data.map((user) => user.email)
    )
    .eq("companyId", companyId)
    .is("revokedAt", null)
    .select("id");

  if (revokeInvites.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(revokeInvites.error.message, "Failed to revoke invites")
      )
    );
  }

  // Best-effort audit of each revocation.
  if (revokeInvites.data && revokeInvites.data.length > 0) {
    try {
      await insertAuditLogEntries(
        serviceRole,
        companyId,
        revokeInvites.data.map((invite) => ({
          tableName: "invite" as const,
          entityType: "invite" as const,
          entityId: invite.id,
          recordId: invite.id,
          operation: "UPDATE" as const,
          actorId: userId,
          diff: { revokedAt: { old: null, new: revokedAt } },
          metadata: {
            ipAddress:
              request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
              undefined,
            userAgent: request.headers.get("user-agent") ?? undefined
          }
        }))
      );
    } catch (err) {
      logger.warn("[revoke-invite] audit write skipped", { error: err });
    }
  }

  return data(
    {},
    await flash(request, success("Successfully revoked invites"))
  );
}
