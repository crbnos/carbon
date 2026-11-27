// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { deactivateUser } from "@carbon/auth/users.server";
import { InviteEmail } from "@carbon/documents/email";
import { getSsoAwareInviteLink } from "@carbon/ee/sso.server";
import { CarbonEdition, CONTROLLED_ENVIRONMENT } from "@carbon/env";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { nanoid } from "nanoid";
import { render } from "react-email";
import { sendCompanyEmail } from "../../../email/company-email";
import {
  type AdminOutcome,
  resendInvite,
  revocationStands
} from "../../../invite-refresh";
import { inngest } from "../../client";

export const userAdminFunction = inngest.createFunction(
  { id: "user-admin", retries: 3 },
  { event: "carbon/user-admin" },
  async ({ event, step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const payload = event.data;
    logger.info("User admin update", { type: payload.type, id: payload.id });

    let result: AdminOutcome;
    if (payload.type === "resend") {
      const { id: userId, companyId, location, ip, revokedAt } = payload;
      // The request checked the invite was re-sendable; an acceptance or a
      // revoke while this waited in the queue skips the refresh, and one
      // after it skips the delivery: no email goes out.
      result = await resendInvite(
        serviceRole,
        step,
        { userId, companyId, revokedAt },
        async (invite) => {
          const [company, inviter] = await Promise.all([
            serviceRole
              .from("company")
              .select("name")
              .eq("id", companyId)
              .single(),
            serviceRole
              .from("user")
              .select("email, fullName")
              .eq("id", invite.createdBy)
              .single()
          ]);
          if (!company.data) throw new Error("Failed to load company");

          const inviteLink = await getSsoAwareInviteLink(
            serviceRole,
            invite.email,
            invite.code,
            companyId
          );

          await sendCompanyEmail(serviceRole, companyId, {
            to: invite.email,
            subject: `You have been invited to join ${company.data.name} on Carbon`,
            headers: {
              "X-Entity-Ref-ID": nanoid()
            },
            html: await render(
              InviteEmail({
                invitedByEmail: inviter.data?.email ?? invite.email,
                invitedByName: inviter.data?.fullName ?? "",
                email: invite.email,
                name: invite.name,
                companyName: company.data.name,
                inviteLink,
                ip,
                location,
                controlledEnvironment: CONTROLLED_ENVIRONMENT
              })
            )
          });
        }
      );
    } else {
      result = await step.run(
        "user-admin-action",
        async (): Promise<AdminOutcome> => {
          logger.info("Deactivating a user", { id: payload.id });
          // Queued by Revoke Invite: a resend and an acceptance since then
          // keep the account.
          if (
            payload.revokedAt &&
            !(await revocationStands(serviceRole, {
              userId: payload.id,
              companyId: payload.companyId,
              revokedAt: payload.revokedAt
            }))
          ) {
            return {
              outcome: "skipped",
              message:
                "The invite was sent again or accepted after the revoke: nothing deactivated"
            };
          }
          const deactivated = await deactivateUser(
            serviceRole,
            payload.id,
            payload.companyId,
            payload.actorId,
            payload.ip
          );
          if (!deactivated.success) {
            return { outcome: "failed", message: deactivated.message };
          }
          if (CarbonEdition === Edition.Cloud) {
            await updateSubscriptionQuantityForCompany(payload.companyId);
          }
          return { outcome: "done", message: deactivated.message };
        }
      );
    }

    if (result.outcome === "failed") {
      logger.error("Admin action {payloadType} failed for {payloadId}", {
        payloadType: payload.type,
        payloadId: payload.id,
        reason: result.message
      });
    } else {
      logger.info(
        result.outcome === "done"
          ? "User admin action succeeded"
          : "User admin action skipped",
        {
          id: payload.id,
          message: result.message
        }
      );
    }

    return { ...result, success: result.outcome !== "failed" };
  }
);
