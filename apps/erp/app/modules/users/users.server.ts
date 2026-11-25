// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { accountProfileValidator } from "@carbon/account";
import { defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import { CarbonEdition, CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { deactivateUser } from "@carbon/auth/users.server";
import { LEVELS, pageById } from "@carbon/database/access";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { generateConsolePin, setEmployeePin } from "@carbon/ee/console.server";
import {
  ACCESS_READER_GATE,
  SUBJECT_RULES,
  subjectGates
} from "@carbon/ee/permission-grants";
import {
  adminRemovalRefusal,
  adminTypeChangeRefusal,
  grantWriteRefusal,
  deleteEmployeeType as removeEmployeeType,
  subjectEntitlement
} from "@carbon/ee/permissions.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { batchTrigger, refreshResentInvite } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import {
  datetime,
  Edition,
  isAllowedAvatarValue,
  isOwnAvatarUpload,
  isOwnSignaturePath,
  requireAffected,
  requiresItarEntityCertification
} from "@carbon/utils";
import { z } from "zod";
import {
  refuseKeyWithout,
  refuseUnlessOwned
} from "~/modules/shared/shared.service";
import {
  bulkPermissionEditTypes,
  convertConsoleOperatorPermission,
  convertOperatorValidator,
  createOperatorValidator,
  grantModule,
  grantsSchema,
  itarEntityCertificationValidator,
  itarUserCertificationValidator,
  permissionsValidator,
  US_PERSON_ATTESTATION_REQUIRED,
  userFlagValidator
} from "./users.models";
import * as service from "./users.service";

const logger = getLogger("erp", "users");
// ---------------------------------------------------------------------------
// Operations (`defineServiceFn`): what the routes, the API and MCP all run
// ---------------------------------------------------------------------------
//
// The invite emails and the audit records show the request's IP, city and
// user agent. They come from `ctx.origin`, which the entry point reads from
// the request's headers, never from the input: a caller cannot set them.

/**
 * Invite an employee: create their account in the company and email them
 * the invite link.
 *
 * @remarks
 * The person gets the employee type's permissions when they accept the
 * invite, which they do from the email, outside the API. Without role
 * authoring (the PERMISSIONS feature), the invite always gets the Admin
 * employee type, whatever was asked for. Only an Admin may invite someone as
 * Admin. A first-time invite writes the employee under the caller's
 * permissions, so it needs Edit on Accounts and Create on Employees as well;
 * an API key without them is refused. In a controlled environment the inviter
 * must attest the person is a U.S. person (a `validation` error otherwise).
 * Once SSO is on, an email outside its domains is refused (a `rule` error). A
 * deactivated or still-invited person is invited again: a new code, and the
 * link already sent stops working. Returns the new employee's user id.
 *
 * @param email - The person's email address. The invite link goes to it.
 * @param firstName - The person's first name.
 * @param lastName - The person's last name.
 * @param employeeType - The employee type that decides the person's permissions. See users_getEmployeeTypes.
 * @param locationId - The person's location. See resources_getLocations.
 * @param usPersonAttestation - Controlled environments only: the inviter attests the person is a U.S. person (22 CFR 120.62). Ignored elsewhere.
 *
 * @mcp
 */
export const inviteEmployee = defineServiceFn({
  input: z.object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    employeeType: z.string().min(1),
    locationId: z.string().min(1),
    usPersonAttestation: z.boolean().default(false)
  }),
  permission: { "users.accounts": "Create" },
  async run(ctx, input) {
    const keyRefused = refuseKeyWithout(ctx, {
      "users.accounts": "Edit",
      "people.employees": "Create"
    });
    if (keyRefused) return keyRefused;

    const companyId = ctx.company.id;
    const client = ctx.asCaller.supabase;

    let employeeType = input.employeeType;
    const canAuthorRoles = await companyHasFeature(client, companyId, {
      feature: "PERMISSIONS"
    });
    if (!canAuthorRoles) {
      const adminType = await client
        .from("employeeType")
        .select("id")
        .eq("companyId", companyId)
        .eq("systemType", "Admin")
        .maybeSingle();
      if (adminType.data?.id) employeeType = adminType.data.id;
    }
    // A re-add of a deactivated person moves them off the type they had.
    const existing = await ctx.asSystem.pg
      .selectFrom("employee")
      .innerJoin("user", "user.id", "employee.id")
      .select("employee.employeeTypeId")
      .where("employee.companyId", "=", companyId)
      .where("user.email", "=", input.email.toLowerCase())
      .executeTakeFirst();
    const adminRefused = await adminTypeChangeRefusal(ctx.asSystem.pg, {
      companyId,
      actor: ctx.actor,
      typeIds: [employeeType, existing?.employeeTypeId]
    });
    if (adminRefused) return grantWriteRefusal(ctx, adminRefused);

    // 22 CFR 120.62: the inviter attests the invitee is a U.S. person.
    if (CONTROLLED_ENVIRONMENT && !input.usPersonAttestation) {
      return ctx.error("validation", US_PERSON_ATTESTATION_REQUIRED);
    }

    const outsideSso = await service.refuseEmailOutsideSso(ctx, input.email);
    if (outsideSso) return outsideSso;

    const created = await service.createEmployeeAccount(
      client,
      ctx.asSystem.pg,
      {
        email: input.email.toLowerCase(),
        firstName: input.firstName,
        lastName: input.lastName,
        employeeType,
        locationId: input.locationId,
        companyId,
        createdBy: ctx.auditUserId,
        attestedBy: CONTROLLED_ENVIRONMENT ? ctx.auditUserId : null,
        attestedAt: CONTROLLED_ENVIRONMENT ? datetime.timestamp() : null
      }
    );
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create employee account",
        created
      );
    }

    const sender = await service.inviteSender(ctx);
    if (!sender) return ctx.error("internal", "Failed to load company or user");
    await service.sendInviteEmail(ctx, {
      ...sender,
      email: input.email,
      code: created.code,
      name: `${input.firstName} ${input.lastName}`.trim()
    });
    return { userId: created.userId };
  }
});
/**
 * Invite a customer contact: create their customer portal account and email
 * them the invite link.
 *
 * @remarks
 * The contact must be one of the customer's contacts and have an email
 * address. The person gets the customer portal permissions when they accept
 * the invite, which they do from the email, outside the API. A person who
 * already has an account or a pending invite in the company is refused (a
 * `conflict` error): users_resendInvites sends a pending invite again. A
 * person whose account was deactivated is invited again. The account is
 * written under the caller's permissions, so the caller also needs Edit on
 * Customers. Returns the new account's user id.
 *
 * @param customerContactId - The customer contact to invite. See sales_getCustomerContacts.
 * @param customerId - The contact's customer. See sales_getCustomers.
 *
 * @mcp
 */
export const inviteCustomerContact = defineServiceFn({
  input: z.object({
    customerContactId: z.string().min(1),
    customerId: z.string().min(1)
  }),
  permission: { "users.accounts": "Create" },
  async run(ctx, { customerContactId, customerId }) {
    const refused = service.refuseUnlessCan(ctx, { "sales.customers": "Edit" });
    if (refused) return refused;
    const uninvitable = await service.refuseUninvitableContact(ctx, {
      role: "customer",
      id: customerContactId,
      customerId
    });
    if (uninvitable) return uninvitable;

    const created = await service.createCustomerAccount(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      {
        id: customerContactId,
        customerId,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create customer account",
        created
      );
    }
    return service.emailAccountInvite(ctx, created);
  }
});

/**
 * Invite a supplier contact: create their supplier portal account and email
 * them the invite link.
 *
 * @remarks
 * The contact must be one of the supplier's contacts and have an email
 * address. The person gets the supplier portal permissions when they accept
 * the invite, which they do from the email, outside the API. A person who
 * already has an account or a pending invite in the company is refused (a
 * `conflict` error): users_resendInvites sends a pending invite again. A
 * person whose account was deactivated is invited again. The account is
 * written under the caller's permissions, so the caller also needs Edit on
 * Suppliers. Returns the new account's user id.
 *
 * @param supplierContactId - The supplier contact to invite. See purchasing_getSupplierContacts.
 * @param supplierId - The contact's supplier. See purchasing_getSuppliers.
 *
 * @mcp
 */
export const inviteSupplierContact = defineServiceFn({
  input: z.object({
    supplierContactId: z.string().min(1),
    supplierId: z.string().min(1)
  }),
  permission: { "users.accounts": "Create" },
  async run(ctx, { supplierContactId, supplierId }) {
    const refused = service.refuseUnlessCan(ctx, {
      "purchasing.suppliers": "Edit"
    });
    if (refused) return refused;
    const uninvitable = await service.refuseUninvitableContact(ctx, {
      role: "supplier",
      id: supplierContactId,
      supplierId
    });
    if (uninvitable) return uninvitable;

    const created = await service.createSupplierAccount(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      {
        id: supplierContactId,
        supplierId,
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create supplier account",
        created
      );
    }
    return service.emailAccountInvite(ctx, created);
  }
});

/**
 * Send invites again.
 *
 * @remarks
 * For a person who is invited and has not accepted, or whose account was
 * deactivated: what the Employees, Customers and Suppliers lists offer it
 * on. One user is re-invited at once: the invite gets a new code (the link
 * already sent stops working), its acceptance and revocation are cleared,
 * and its `createdAt` restarts the controlled-environment expiry. Several
 * users are queued as a job (`queued: true`), which sends the emails a few
 * moments later. Refused, for every user, when one is on the Admin type and
 * the caller is not an Admin (a `forbidden` error), has no invite here (a
 * `notFound` error), has an active account in the company, or was a customer
 * or supplier contact whose account was deactivated (a `rule` error; invite
 * that contact again with users_inviteCustomerContact or
 * users_inviteSupplierContact). An invite revoked after this call read it is
 * not sent (a `conflict` error for one user; the job skips it for several).
 *
 * @param userIds - The users to invite again, at least one. See users_getEmployees (status Invited or Inactive), users_getCustomers and users_getSuppliers.
 *
 * @mcp
 */
export const resendInvites = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1)
  }),
  permission: { "users.accounts": "Create" },
  async run(ctx, { userIds }) {
    const companyId = ctx.company.id;
    const { ip, city } = ctx.origin;
    // Accepting brings a deactivated person back on the type they kept: an Admin's is an Admin's call.
    const adminRefused = await adminRemovalRefusal(ctx.asSystem.pg, {
      companyId,
      actor: ctx.actor,
      userIds
    });
    if (adminRefused) return grantWriteRefusal(ctx, adminRefused);
    // Each invite's revocation as read here: the refresh clears only that one.
    const reinvitable = await service.refuseUnlessReinvitable(ctx, userIds);
    if (reinvitable.error) return reinvitable.error;
    const revokedAt = reinvitable.data;
    if (userIds.length > 1) {
      try {
        await batchTrigger(
          "user-admin",
          userIds.map((id) => ({
            payload: {
              id,
              type: "resend" as const,
              companyId,
              location: city ?? "Unknown",
              ip: ip ?? "127.0.0.1",
              revokedAt: revokedAt.get(id) ?? null
            }
          }))
        );
      } catch (err) {
        return ctx.error("internal", "Failed to reinvite users", err);
      }
      return { queued: true };
    }

    const [userId] = userIds;
    const serviceRole = ctx.asSystem.supabase;
    const [company, user] = await Promise.all([
      serviceRole.from("company").select("name").eq("id", companyId).single(),
      serviceRole
        .from("user")
        .select("email, fullName")
        .eq("id", userId)
        .single()
    ]);
    if (!company.data || !user.data) {
      return ctx.error("internal", "Failed to load company or user");
    }

    // An acceptance or a revoke since the check above fails the refresh: no
    // new code, no email.
    const refreshed = await refreshResentInvite(serviceRole, {
      userId,
      email: user.data.email,
      companyId,
      revokedAt: revokedAt.get(userId) ?? null
    });
    if ("failure" in refreshed) {
      return ctx.error(
        refreshed.failure === "accepted"
          ? "rule"
          : refreshed.failure === "revoked"
            ? "conflict"
            : refreshed.failure,
        refreshed.message
      );
    }

    const inviter = await serviceRole
      .from("user")
      .select("email, fullName")
      .eq("id", refreshed.createdBy)
      .single();

    await service.sendInviteEmail(ctx, {
      companyName: company.data.name,
      invitedBy: {
        email: inviter.data?.email ?? user.data.email,
        fullName: inviter.data?.fullName ?? null
      },
      email: user.data.email,
      code: refreshed.code,
      name: user.data.fullName ?? ""
    });
    return { queued: false };
  }
});

/**
 * Revoke pending invites, so the links already sent stop working.
 *
 * @remarks
 * Revoking deactivates the user, so it needs Full on Accounts, as the
 * lists' Revoke Invite does. Only an invite not yet accepted is taken:
 * every user must have an invite here that is not accepted, and no membership
 * in the company (an employee who already joined is deactivated with
 * users_deactivateUsers). Every invite still pending is marked revoked first,
 * and only its user is deactivated: an invite accepted in the meantime is
 * left alone. An invite already revoked is not revoked again, but its user is
 * deactivated again, which finishes a deactivation that did not run. One user
 * is deactivated at once (and, on Cloud, the subscription's seat count
 * updated); several are deactivated by a job, which skips a user whose invite
 * was sent again or accepted since. A deactivation that fails before it
 * changes the account leaves the invite pending; one that may have changed
 * it, or could not be queued, leaves the invite revoked, and the job or a
 * revoke sent again finishes it. Each revocation that stands is written to
 * the audit log when the company keeps one. Returns how many invites this
 * call revoked.
 *
 * @param userIds - The invited users, from 1 to 100. See users_getEmployees (status Invited) and users_getUnrevokedInviteEmails.
 *
 * @mcp destructive
 */
export const revokeInvites = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1).max(100)
  }),
  permission: { "users.accounts": "Full" },
  async run(ctx, { userIds }) {
    const companyId = ctx.company.id;
    const actorId = ctx.auditUserId;
    const serviceRole = ctx.asSystem.supabase;
    const { ip, userAgent } = ctx.origin;

    const pending = await service.refuseUnlessPendingInvites(ctx, userIds);
    if (pending.error) return pending.error;
    const invites = pending.data;

    // The revoke is the write that decides: it stamps only invites still
    // pending, and an acceptance needs `revokedAt` null, so an invite accepted
    // since the check is not revoked, and its account is not deactivated.
    const revokedAt = datetime.timestamp();
    const toStamp = invites.filter((invite) => invite.revokedAt === null);
    let stamped: { id: string }[] = [];
    if (toStamp.length > 0) {
      const revoked = await serviceRole
        .from("invite")
        .update({ revokedAt })
        .in(
          "id",
          toStamp.map((invite) => invite.inviteId)
        )
        .eq("companyId", companyId)
        .is("acceptedAt", null)
        .is("revokedAt", null)
        .select("id");
      if (revoked.error) {
        return ctx.error("internal", "Failed to revoke invites", revoked.error);
      }
      stamped = revoked.data;
    }
    const stampedIds = new Set(stamped.map((invite) => invite.id));
    // Each user to deactivate, with the revocation its job must still find:
    // this call's, or an earlier one's whose deactivation may not have run.
    const toDeactivate = invites.flatMap((invite) =>
      stampedIds.has(invite.inviteId)
        ? [{ id: invite.userId, revokedAt }]
        : invite.revokedAt !== null
          ? [{ id: invite.userId, revokedAt: invite.revokedAt }]
          : []
    );

    // A deactivation that fails before it changes the account gives the
    // invites this call revoked back, as pending: the revoke can be sent
    // again.
    const unrevoke = async (cause: unknown, message: string) => {
      if (stamped.length > 0) {
        const restored = await serviceRole
          .from("invite")
          .update({ revokedAt: null })
          .in(
            "id",
            stamped.map((invite) => invite.id)
          )
          .eq("companyId", companyId)
          .eq("revokedAt", revokedAt);
        if (restored.error) {
          logger.error("Failed to restore revoked invites", {
            companyId,
            error: restored.error
          });
        }
      }
      return ctx.error("internal", message, cause);
    };

    // The users the job deactivates: several, or the one whose deactivation
    // threw. `deactivateUser` returns a failed account write, and throws only
    // after the writes (clearing the cached claims), so a throw keeps the
    // invite revoked and the job, which retries, runs the deactivation again.
    let toQueue = toDeactivate.length > 1 ? toDeactivate : [];
    if (toDeactivate.length === 1) {
      const deactivated = await deactivateUser(
        serviceRole,
        toDeactivate[0].id,
        companyId,
        actorId,
        ip
      ).catch((error: unknown) => {
        logger.error("Failed to finish deactivating a revoked invite's user", {
          companyId,
          error
        });
        return null;
      });
      if (deactivated === null) {
        toQueue = toDeactivate;
      } else if (!deactivated.success) {
        return unrevoke(deactivated.message, "Failed to deactivate user");
      } else if (CarbonEdition === Edition.Cloud) {
        await updateSubscriptionQuantityForCompany(companyId);
      }
    }

    // The send can reject after Inngest accepted the events, and an accepted
    // deactivation still runs: the invites stay revoked, never reopened, and
    // a revoke sent again for them runs the deactivation that did not.
    let unqueued: { cause: unknown } | null = null;
    if (toQueue.length > 0) {
      try {
        await batchTrigger(
          "user-admin",
          toQueue.map((user) => ({
            payload: {
              id: user.id,
              type: "deactivate" as const,
              companyId,
              actorId,
              ip,
              revokedAt: user.revokedAt
            }
          }))
        );
      } catch (cause) {
        unqueued = { cause };
      }
    }

    // Best effort: a company without audit logging has no audit log table.
    if (stamped.length > 0) {
      try {
        await insertAuditLogEntries(
          serviceRole,
          companyId,
          stamped.map((invite) => ({
            tableName: "invite" as const,
            entityType: "invite" as const,
            entityId: invite.id,
            recordId: invite.id,
            operation: "UPDATE" as const,
            actorId,
            diff: { revokedAt: { old: null, new: revokedAt } },
            metadata: { ipAddress: ip, userAgent }
          }))
        );
      } catch (err) {
        logger.warning("Audit write skipped for a revoked invite", {
          error: err
        });
      }
    }
    if (unqueued) {
      return ctx.error(
        "internal",
        "Revoked the invites, but deactivating their users may not have been queued: revoke them again to finish",
        unqueued.cause
      );
    }
    return { revoked: stamped.length };
  }
});

/**
 * Deactivate users in the company: remove their access and their grants
 * here.
 *
 * @remarks
 * Takes employees, customer accounts and supplier accounts, active or still
 * invited. Each user loses their membership, their permissions and their
 * groups in the company, and their open invite here is revoked. An
 * employee's job record (title, location, manager) stays. Refuses the
 * caller's own account, an Admin's unless the caller is an Admin (a
 * `forbidden` error), and a user with no membership, account or invite in
 * the company (a `notFound` error). One user is deactivated at once, and
 * `message` says how it went; several are deactivated by a job
 * (`queued: true`) a few moments later. To give an employee access back,
 * send the invite again (users_resendInvites); a customer or supplier
 * contact is invited again with users_inviteCustomerContact or
 * users_inviteSupplierContact.
 *
 * @param userIds - The users to deactivate, at least one. See users_getEmployees, users_getCustomers and users_getSuppliers.
 *
 * @mcp destructive
 */
export const deactivateUsers = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1)
  }),
  permission: { "users.accounts": "Full" },
  async run(ctx, { userIds }) {
    const companyId = ctx.company.id;
    const { ip } = ctx.origin;
    const actorId = ctx.auditUserId;
    if (userIds.includes(actorId)) {
      return ctx.error("rule", "You cannot deactivate yourself");
    }
    const adminRefused = await adminRemovalRefusal(ctx.asSystem.pg, {
      companyId,
      actor: ctx.actor,
      userIds
    });
    if (adminRefused) return grantWriteRefusal(ctx, adminRefused);
    const outside = await service.refuseUnlessCompanyUsers(ctx, userIds);
    if (outside) return outside;

    if (userIds.length === 1) {
      // The service role: "userPermission" has no UPDATE policy, so under the
      // caller's client the permission strip matched no rows and the user
      // kept every grant for this company.
      const result = await deactivateUser(
        ctx.asSystem.supabase,
        userIds[0],
        companyId,
        actorId,
        ip
      );
      if (!result.success) {
        return ctx.error(
          "internal",
          result.message ?? "Failed to deactivate user"
        );
      }
      return { queued: false, message: result.message };
    }

    try {
      await batchTrigger(
        "user-admin",
        userIds.map((id) => ({
          payload: { id, type: "deactivate" as const, companyId, actorId, ip }
        }))
      );
    } catch (err) {
      return ctx.error("internal", "Failed to deactivate users", err);
    }
    return {
      queued: true,
      message: "Success. Please check back in a few moments."
    };
  }
});

/**
 * Change an employee's employee type and replace their overrides in the
 * company.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). The employee and the type
 * must both be the company's. Access is the role's grants with these
 * overrides on top. The move and the overrides are one write and one entry in
 * the permission audit log, which records the request's IP.
 */
export const updateEmployeePermissions = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    employeeType: z.string().min(1),
    grants: grantsSchema
  }),
  permission: subjectGates("Edit").person,
  async run(ctx, { id, employeeType, grants }) {
    const refused = await service.saveAccessGrants(ctx, {
      subjectType: "person",
      subjectId: id,
      change: { set: grants },
      employeeType,
      ip: ctx.origin.ip
    });
    if (refused) return refused;
    return { id };
  }
});

/**
 * Apply the same overrides to several employees in the company, in a job.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). Every user must be an
 * employee of the company. The call only queues one job per user (`count`):
 * the grants change a few moments later, and each change is written to the
 * permission audit log. `editType: "add"` only raises a level; `"update"`
 * sets it.
 */
export const bulkUpdatePermissions = defineServiceFn({
  input: z.object({
    editType: z.enum(bulkPermissionEditTypes),
    userIds: z.array(z.string().min(1)).min(1),
    grants: grantsSchema
  }),
  permission: subjectGates("Edit").person,
  async run(ctx, { editType, userIds, grants }) {
    const unentitled = await grantWriteRefusal(
      ctx,
      await subjectEntitlement(ctx.asCaller.supabase, ctx.company.id, "person")
    );
    if (unentitled) return unentitled;

    const companyId = ctx.company.id;
    const outside = await service.refuseUnlessCompanyEmployees(ctx, userIds);
    if (outside) return outside;

    const uniqueUserIds = [...new Set(userIds)];
    await service.queuePermissionUpdates({
      userIds: uniqueUserIds,
      companyId,
      actorId: ctx.auditUserId,
      grants,
      addOnly: editType === "add",
      ip: ctx.origin.ip
    });
    return { count: uniqueUserIds.length };
  }
});

/**
 * Create an employee type with its permissions.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). The type and its grants
 * are written in one transaction: when the grants fail, no type is created.
 */
export const createEmployeeType = defineServiceFn({
  input: z.object({
    name: z.string().trim().min(1),
    grants: grantsSchema
  }),
  // Edit, not Create: the grants are written without RLS, which asks Edit of
  // a grant write.
  permission: subjectGates("Edit").role,
  async run(ctx, { name, grants }) {
    return service.writeEmployeeType(ctx, {
      employeeType: { name },
      grants
    });
  }
});

/**
 * Rename an employee type and replace its grants.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). Refused when the type is
 * not the company's. One transaction, as for `createEmployeeType`.
 */
export const updateEmployeeType = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    grants: grantsSchema
  }),
  permission: subjectGates("Edit").role,
  async run(ctx, { id, name, grants }) {
    return service.writeEmployeeType(ctx, {
      employeeType: { id, name },
      grants
    });
  }
});

/**
 * Delete an employee type.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). A protected type (Admin,
 * Console Operator) is never deleted.
 */
export const deleteEmployeeType = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: subjectGates("Full").role,
  async run(ctx, { id }) {
    const refused = await grantWriteRefusal(
      ctx,
      removeEmployeeType(ctx.asCaller.supabase, {
        companyId: ctx.company.id,
        id
      })
    );
    return refused ?? { id };
  }
});

/**
 * What an employee can do on each page, and the grant that decides it: the
 * Admin type, their own override, or their role.
 */
export const getEffectiveAccess = defineServiceFn({
  input: z.object({ userId: z.string().min(1) }),
  permission: subjectGates("View").person,
  async run(ctx, { userId }) {
    const access = await service.readEffectiveAccess(ctx, userId);
    if (!access) return ctx.error("notFound", SUBJECT_RULES.person.notFound);
    return access;
  }
});

/**
 * The employees whose level on a page reaches `level`, and, with the
 * settings view, the API keys.
 */
export const getPageAccessHolders = defineServiceFn({
  input: z.object({
    page: z
      .string()
      .min(1)
      .refine((page) => pageById(page) !== undefined, {
        message: "Unknown page"
      }),
    level: z.enum(LEVELS)
  }),
  permission: ACCESS_READER_GATE,
  async run(ctx, { page, level }) {
    return service.readPageAccessHolders(ctx, page, level);
  }
});

/**
 * Every role's grants in the company.
 *
 * @remarks
 * The person access editor reads them too (what each employee type would
 * give the person), so an Accounts viewer may read them without the
 * Employee Types page.
 */
export const getRoleGrants = defineServiceFn({
  input: z.object({}),
  permission: ACCESS_READER_GATE,
  async run(ctx) {
    return service.readRoleGrants(ctx);
  }
});

/** The grants of a role, a person or an API key in the company. */
export const getAccessGrants = defineServiceFn({
  input: z.object({
    subjectType: permissionsValidator.shape.subjectType,
    subjectId: z.string().min(1)
  }),
  permission: { by: "subjectType", rules: subjectGates("View") },
  async run(ctx, { subjectType, subjectId }) {
    return service.readAccessGrants(ctx, subjectType, subjectId);
  }
});

/**
 * Replace the grants of a role, a person or an API key with the given set.
 *
 * @remarks
 * Each grant names a module and, optionally, one of its pages, with a level:
 * None, View, Create, Edit or Full. A null level stores no grant, so the
 * subject inherits; None removes access. A role edit applies to everyone on
 * the role at once. Roles and people need role authoring (the PERMISSIONS
 * feature), API keys the API_KEYS feature.
 */
export const upsertAccessGrants = defineServiceFn({
  input: permissionsValidator,
  permission: { by: "subjectType", rules: subjectGates("Edit") },
  async run(ctx, { subjectType, subjectId, grants }) {
    const refused = await service.saveAccessGrants(ctx, {
      subjectType,
      subjectId,
      change: { set: grants },
      ip: ctx.origin.ip
    });
    if (refused) return refused;
    return { subjectType, subjectId };
  }
});

/**
 * Remove one grant of a role, a person or an API key, so the subject inherits
 * that module or page again.
 */
export const deleteAccessGrant = defineServiceFn({
  input: z.object({
    subjectType: permissionsValidator.shape.subjectType,
    subjectId: z.string().min(1),
    module: grantModule,
    page: z.string().min(1).nullable()
  }),
  permission: { by: "subjectType", rules: subjectGates("Edit") },
  async run(ctx, { subjectType, subjectId, module, page }) {
    const refused = await service.saveAccessGrants(ctx, {
      subjectType,
      subjectId,
      change: { remove: { module, page } },
      ip: ctx.origin.ip
    });
    if (refused) return refused;
    return { subjectType, subjectId };
  }
});

// A member without the prefix would be dropped silently by the write.
const groupMembers = z
  .array(
    z.string().regex(/^(user|group)_.+/, {
      message: "A member is user_<id> or group_<id>"
    })
  )
  .min(1);

/**
 * Create a group with its members.
 *
 * @remarks
 * Needs Create on Groups, as the New Group form does. Members are users
 * (`user_<id>`) and groups (`group_<id>`), each the company's (a `notFound`
 * error otherwise); a member sent twice is saved once. The group and its
 * members are saved together, or neither is.
 *
 * @param name - The group's name.
 * @param selections - The members, at least one: `user_<userId>` (see users_getEmployees) or `group_<groupId>` (see users_getGroups).
 *
 * @mcp
 */
export const createGroup = defineServiceFn({
  input: z.object({ name: z.string().trim().min(1), selections: groupMembers }),
  permission: { "users.groups": "Create" },
  async run(ctx, { name, selections }) {
    const members = service.groupMembersOf(selections);
    const foreign = await service.refuseForeignGroupMembers(ctx, members);
    if (foreign) return foreign;

    try {
      const id = await service.insertGroupWithMembers(ctx.asSystem.pg, {
        name,
        companyId: ctx.company.id,
        members
      });
      return { id };
    } catch (err) {
      return ctx.error("internal", "Failed to create the group", err);
    }
  }
});

/**
 * Rename a group and replace its members.
 *
 * @remarks
 * Needs Edit on Groups. The members sent replace every member the group
 * had, in one write with the name. Each member must be the company's (a
 * `notFound` error otherwise) and a group is never its own member (a
 * `validation` error); a member sent twice is saved once. Refused when the
 * group is not the company's.
 *
 * @param id - The group. See users_getGroups.
 * @param name - The group's name.
 * @param selections - Every member, at least one: `user_<userId>` (see users_getEmployees) or `group_<groupId>` (see users_getGroups).
 *
 * @mcp
 */
export const updateGroup = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    selections: groupMembers
  }),
  permission: { "users.groups": "Edit" },
  async run(ctx, { id, name, selections }) {
    const missing = await refuseUnlessOwned(ctx, "group", { id });
    if (missing) return missing;
    const members = service.groupMembersOf(selections);
    const foreign = await service.refuseForeignGroupMembers(ctx, members, id);
    if (foreign) return foreign;

    try {
      const replaced = await service.replaceGroup(ctx.asSystem.pg, {
        id,
        name,
        companyId: ctx.company.id,
        members
      });
      if (!replaced) return ctx.error("notFound", "Group not found");
    } catch (err) {
      return ctx.error("internal", "Failed to update group", err);
    }
    return { id };
  }
});

/**
 * Add a console operator: a PIN-only person who pins in at MES consoles.
 *
 * @remarks
 * The operator gets the company's Console Operator employee type and a new
 * 4-digit PIN, stored only as a hash and returned once. The subscription's
 * seat count is updated. When the PIN cannot be set, the operator stays and
 * the error says to reset the PIN.
 */
export const addConsoleOperator = defineServiceFn({
  input: createOperatorValidator,
  permission: { "users.operators": "Create" },
  async run(ctx, { firstName, lastName, locationId }) {
    const companyId = ctx.company.id;
    const operatorType = await ctx.asSystem.supabase
      .from("employeeType")
      .select("id")
      .eq("companyId", companyId)
      .eq("systemType", "Console Operator")
      .single();
    if (operatorType.error || !operatorType.data) {
      return ctx.error(
        "internal",
        "Console Operator employee type not found. Run the migration.",
        operatorType.error
      );
    }

    const created = await service.createConsoleOperator(ctx.asCaller.supabase, {
      firstName,
      lastName,
      employeeType: operatorType.data.id,
      locationId,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create console operator",
        created
      );
    }

    const pin = generateConsolePin();
    try {
      await setEmployeePin(ctx.asSystem.pg, {
        employeeId: created.userId,
        companyId,
        pin,
        updatedBy: ctx.auditUserId
      });
    } catch (err) {
      await updateSubscriptionQuantityForCompany(companyId);
      return ctx.error(
        "internal",
        "Operator created, but the PIN could not be set. Use Reset PIN.",
        err
      );
    }

    await updateSubscriptionQuantityForCompany(companyId);
    return { userId: created.userId, name: created.name, pin };
  }
});

/**
 * Give a person a new console PIN. Their old PIN stops working at once.
 *
 * @remarks
 * A PIN pins in as that person at any MES console, with their access, so
 * resetting one hands over their shop-floor identity. Operators Edit covers a
 * console operator (the Console Operator type); anyone else also needs Edit on
 * Accounts and on Settings → People. Only an Admin resets an Admin's PIN, and
 * no one resets the PIN of someone with more access than they hold on any page
 * (`pinResetRefusal`). The PIN is stored only as a hash and returned once.
 */
export const resetConsoleOperatorPin = defineServiceFn({
  input: z.object({ operatorId: z.string().min(1) }),
  permission: { "users.operators": "Edit" },
  async run(ctx, { operatorId }) {
    const refused = await service.refusePinReset(ctx, operatorId);
    if (refused) return refused;

    const pin = generateConsolePin();
    try {
      await setEmployeePin(ctx.asSystem.pg, {
        employeeId: operatorId,
        companyId: ctx.company.id,
        pin,
        updatedBy: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to reset PIN", err);
    }
    return { pin };
  }
});

/**
 * Turn a console operator into a full user: a sign-in account under a real
 * email, the chosen employee type, and an invite email.
 *
 * @remarks
 * Needs Accounts Edit as well as Operators Edit: it moves the person to an
 * employee type. When the grant write refuses, nothing is converted. The
 * permission audit log records the request's IP.
 */
export const convertConsoleOperator = defineServiceFn({
  input: convertOperatorValidator.extend({
    operatorId: z.string().min(1)
  }),
  permission: convertConsoleOperatorPermission,
  async run(ctx, { operatorId, email, employeeType }) {
    const refused = await service.convertConsoleOperatorToUser(ctx, {
      userId: operatorId,
      email,
      employeeType,
      ip: ctx.origin.ip
    });
    if (refused) return refused;
    return { id: operatorId };
  }
});

const RIDER_SIGNER =
  "The Rider must be accepted by a representative of the company it binds.";

/**
 * Accept the ITAR Rider on behalf of the company.
 *
 * @remarks
 * It unblocks the whole company's controlled-environment gate, so it needs
 * Edit on Accounts, and the signer must be a real person of the company: an
 * API key signs as no one, and Carbon staff (who hold Edit on Accounts in
 * companies they set up) cannot bind a customer.
 */
export const certifyItarEntity = defineServiceFn({
  input: z.object({
    authorityToBind: z.boolean(),
    acceptRider: z.boolean(),
    fullLegalName: z.string(),
    title: z.string(),
    complianceContact: z.string()
  }),
  permission: { "users.accounts": "Edit" },
  async run(ctx, form) {
    if (ctx.actor.type !== "user") return ctx.error("forbidden", RIDER_SIGNER);
    const signer = await ctx.asSystem.supabase
      .from("user")
      .select("email")
      .eq("id", ctx.actor.userId)
      .single();
    const email = signer.data?.email;
    if (!email || !requiresItarEntityCertification(email)) {
      return ctx.error("forbidden", RIDER_SIGNER);
    }

    const parsed = itarEntityCertificationValidator.safeParse(form);
    if (!parsed.success) {
      return ctx.error("validation", service.firstIssue(parsed.error));
    }
    return service.recordItarCertification(ctx, {
      type: "entity",
      fullLegalName: parsed.data.fullLegalName,
      title: parsed.data.title,
      complianceContact: parsed.data.complianceContact,
      ipAddress: ctx.origin.ip,
      userAgent: ctx.origin.userAgent
    });
  }
});

/** Certify that the caller is a U.S. person, for the controlled environment. */
export const certifyItarUser = defineServiceFn({
  input: z.object({
    certifyUsPerson: z.boolean(),
    agreeNotify: z.boolean(),
    understandPenalty: z.boolean(),
    fullLegalName: z.string()
  }),
  permission: "employee",
  async run(ctx, form) {
    const parsed = itarUserCertificationValidator.safeParse(form);
    if (!parsed.success) {
      return ctx.error("validation", service.firstIssue(parsed.error));
    }
    return service.recordItarCertification(ctx, {
      type: "user",
      fullLegalName: parsed.data.fullLegalName,
      ipAddress: ctx.origin.ip,
      userAgent: ctx.origin.userAgent
    });
  }
});
/**
 * The ITAR gate: does a valid, unexpired entity Rider acceptance exist for this company, and a valid user attestation for this user
 *
 * @mcp read
 */
export const getItarCertificationStatus = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { "settings.itarCertifications": "View" },
  async run(ctx) {
    return await service.getItarCertificationStatus(
      ctx.asCaller.supabase,
      ctx.company.id,
      ctx.auditUserId
    );
  }
});

/**
 * The company's latest entity Rider acceptance, or null when nobody has accepted one yet
 *
 * @mcp read
 */
export const getItarEntityCertification = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: "employee",
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getItarEntityCertification(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Compliance report source: every active employee with their latest ITAR certification (version / date / expiry)
 *
 * @mcp read
 */
export const getItarCertificationReport = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { "settings.itarCertifications": "View" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getItarCertificationReport(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete group
 *
 * @mcp destructive
 */
export const deleteGroup = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { "users.groups": "Full" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteGroup(ctx.asCaller.supabase, input.groupId as never)
    );
  }
});

/**
 * Get customers
 *
 * @mcp read
 */
export const getCustomers = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { "users.accounts": "View" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getCustomers(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get employee
 *
 * @mcp read
 */
export const getEmployee = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { "users.accounts": "View" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getEmployee(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get unrevoked invite emails
 *
 * @mcp read
 */
export const getUnrevokedInviteEmails = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { "users.accounts": "View" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getUnrevokedInviteEmails(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * User ids in this company with a verified authenticator
 *
 * @mcp read
 */
export const getUsersWithVerifiedMfa = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { "users.accounts": "View" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getUsersWithVerifiedMfa(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get employees
 *
 * @mcp read
 */
export const getEmployees = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { "users.accounts": "View" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getEmployees(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Gets console operators — users with @console.internal emails
 *
 * @mcp read
 */
export const getConsoleOperators = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { "users.operators": "View" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getConsoleOperators(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get employee type
 *
 * @mcp read
 */
export const getEmployeeType = defineServiceFn({
  input: z.looseObject({ employeeTypeId: z.string() }),
  permission: { "users.employeeTypes": "View" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getEmployeeType(
        ctx.asCaller.supabase,
        input.employeeTypeId as never
      )
    );
  }
});

/**
 * Get employee types
 *
 * @mcp read
 */
export const getEmployeeTypes = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  // Picking a type on invite / convert is Accounts work, so Accounts viewers list them too.
  permission: ACCESS_READER_GATE,
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getEmployeeTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get invitable
 *
 * @mcp read
 */
export const getInvitable = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { "users.accounts": "View" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getInvitable(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get modules
 *
 * @mcp read
 */
export const getModules = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { "users.employeeTypes": "View" },
  async run() {
    return service.getModules();
  }
});

/**
 * Get group
 *
 * @mcp read
 */
export const getGroup = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { "users.groups": "View" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getGroup(ctx.asCaller.supabase, input.groupId as never)
    );
  }
});

/**
 * Get group members
 *
 * @mcp read
 */
export const getGroupMembers = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { "users.groups": "View" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getGroupMembers(
        ctx.asCaller.supabase,
        input.groupId as never
      )
    );
  }
});

/**
 * Get groups
 *
 * @mcp read
 */
export const getGroups = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    uid: z.string().nullable().optional()
  }),
  permission: { "users.groups": "View" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getGroups(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get group emails
 *
 * @mcp read
 */
export const getGroupEmails = defineServiceFn({
  input: z.looseObject({ groupIds: z.array(z.string()) }),
  permission: { "users.groups": "View" },
  async run(ctx, input) {
    return await service.getGroupEmails(
      ctx.asCaller.supabase,
      payload(ctx, input.groupIds).build() as never
    );
  }
});

/**
 * Get user select groups
 *
 * @mcp read
 */
export const getUserSelectGroups = defineServiceFn({
  input: z.looseObject({
    type: z.string().optional(),
    search: z.string().optional(),
    limit: z.number(),
    offset: z.number()
  }),
  permission: { "users.accounts": "View" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getUserSelectGroups(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get user select group members
 *
 * @mcp read
 */
export const getUserSelectGroupMembers = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { "users.accounts": "View" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getUserSelectGroupMembers(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.groupId as never
      )
    );
  }
});

/**
 * Search users for select
 *
 * @mcp read
 */
export const searchUsersForSelect = defineServiceFn({
  input: z.looseObject({
    q: z.string(),
    type: z.string().optional(),
    excludeSelf: z.boolean().optional(),
    allowedIds: z.array(z.string()).optional()
  }),
  permission: { "users.accounts": "View" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.searchUsersForSelect(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).withUser().build() as never
      )
    );
  }
});

/**
 * Resolve user select ids
 *
 * @mcp
 */
export const resolveUserSelectIds = defineServiceFn({
  input: z.looseObject({ ids: z.array(z.string()) }),
  permission: { "users.accounts": "Edit" },
  async run(ctx, input) {
    return await service.resolveUserSelectIds(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input.ids).build() as never
    );
  }
});

/**
 * Get suppliers
 *
 * @mcp read
 */
export const getSuppliers = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { "users.accounts": "View" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSuppliers(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

// The caller's own account: every operation acts on the signed-in user (an
// API key's creator).

/** Change the caller's name, phone and about text. */
export const updateOwnProfile = defineServiceFn({
  input: accountProfileValidator,
  permission: "employee",
  async run(ctx, profile) {
    const saved = await service.updatePublicAccount(ctx.asCaller.supabase, {
      id: ctx.auditUserId,
      ...profile
    });
    if (saved.error) {
      return ctx.error("internal", "Failed to update profile", saved.error);
    }
    return { id: ctx.auditUserId };
  }
});

/**
 * Change the caller's avatar to a generated avatar or their own upload.
 *
 * @remarks
 * Refuses any other value: it could point at another user's file. Saves the
 * new value first, then deletes the uploaded photo it replaced, so a failed
 * save never leaves the avatar pointing at a deleted file. A failed delete
 * only leaves an orphan file, so it is logged, not returned.
 */
export const updateOwnAvatar = defineServiceFn({
  input: z.object({ path: z.string() }),
  permission: "employee",
  async run(ctx, { path }) {
    const userId = ctx.auditUserId;
    if (!isAllowedAvatarValue(userId, path)) {
      return ctx.error("validation", "Invalid avatar path");
    }

    const client = ctx.asCaller.supabase;
    // Only the replaced avatar is needed: the narrow reader, not `select("*")`.
    const previous = await service.getCurrentUser(client, userId);
    if (previous.error) {
      logger.error("Failed to read the avatar being replaced", {
        userId,
        error: previous.error
      });
    }
    const saved = await service.updateAvatar(client, userId, path);
    if (saved.error) {
      return ctx.error("internal", "Failed to update avatar", saved.error);
    }

    const previousPath = previous.data?.avatarUrl;
    if (isOwnAvatarUpload(userId, previousPath) && previousPath !== path) {
      const removal = await client.storage
        .from("avatars")
        .remove([previousPath]);
      if (removal.error) {
        logger.error("Failed to remove the replaced avatar photo", {
          userId,
          path: previousPath,
          error: removal.error
        });
      }
    }
    return { avatarUrl: path };
  }
});

/**
 * Set or remove the caller's own signature.
 *
 * @remarks
 * `path` is a file the caller uploaded to their own folder of the
 * `signatures` bucket, or null to remove the signature. The replaced file is
 * deleted unless an approval recorded it.
 */
export const updateOwnSignature = defineServiceFn({
  input: z.object({ path: z.string().nullable() }),
  permission: "employee",
  async run(ctx, { path }) {
    const userId = ctx.auditUserId;
    if (path !== null && !isOwnSignaturePath(userId, path)) {
      return ctx.error("validation", "Invalid signature path");
    }
    const saved = await service.updateSignature(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      userId,
      path
    );
    if (saved.error) {
      return ctx.error("internal", "Failed to update signature", saved.error);
    }
    return { signaturePath: path };
  }
});

/**
 * Set a person's value of an attribute.
 *
 * @remarks
 * Anyone with resources update may set anyone's value. Others may set only
 * their own, of an attribute marked as self-managed. `value` must match
 * `type` (a boolean for `boolean`, a number for `numeric`, else a string),
 * or nothing is stored for it.
 */
export const upsertAttributeValue = defineServiceFn({
  input: z.object({
    userId: z.string().min(1),
    userAttributeId: z.string().min(1),
    userAttributeValueId: z.string().optional(),
    type: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string()])
  }),
  permission: "employee",
  async run(ctx, { userId, ...value }) {
    const refused = await service.refuseAttributeValueChange(
      ctx,
      userId,
      value.userAttributeId,
      "Unauthorized: Cannot update attribute"
    );
    if (refused) return refused;

    const saved = await service.upsertUserAttributeValue(
      ctx.asCaller.supabase,
      {
        ...value,
        userId,
        updatedBy: ctx.auditUserId
      }
    );
    if (saved.error) {
      return ctx.error(
        "internal",
        "Failed to update attribute value",
        saved.error
      );
    }
    return { userAttributeValueId: saved.data.id };
  }
});

/**
 * Remove a person's value of an attribute.
 *
 * @remarks
 * Allowed as for `upsertAttributeValue`.
 */
export const deleteAttributeValue = defineServiceFn({
  input: z.object({
    userId: z.string().min(1),
    userAttributeId: z.string().min(1),
    userAttributeValueId: z.string().min(1)
  }),
  permission: "employee",
  async run(ctx, value) {
    const refused = await service.refuseAttributeValueChange(
      ctx,
      value.userId,
      value.userAttributeId,
      "Unauthorized: Cannot remove attribute"
    );
    if (refused) return refused;

    const deleted = await service.deleteUserAttributeValue(
      ctx.asCaller.supabase,
      value
    );
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete attribute value",
        deleted.error
      );
    }
    return { userAttributeValueId: value.userAttributeValueId, deleted: true };
  }
});

/**
 * Set one of the caller's flags (a dismissed training panel, a changelog
 * entry seen), keeping the others.
 */
export const setOwnFlag = defineServiceFn({
  input: userFlagValidator,
  permission: "employee",
  async run(ctx, { flag, value }) {
    const userId = ctx.auditUserId;
    const client = ctx.asCaller.supabase;
    const user = await client
      .from("user")
      .select("flags")
      .eq("id", userId)
      .single();
    if (user.error) {
      return ctx.error("internal", "Failed to read user flags", user.error);
    }

    const flags = (user.data?.flags as Record<string, boolean> | null) ?? {};
    const updated = await requireAffected(
      client
        .from("user")
        .update({ flags: { ...flags, [flag]: value } })
        .eq("id", userId)
        .select("id")
    );
    if (updated.error) {
      return ctx.error("internal", "Failed to update flag", updated.error);
    }
    return { flag, value };
  }
});

/**
 * Get notification preferences
 *
 * @mcp read
 */
export const getNotificationPreferences = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: "employee",
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getNotificationPreferences(
        ctx.asCaller.supabase,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert notification preference
 *
 * @mcp
 */
export const upsertNotificationPreference = defineServiceFn({
  input: z.looseObject({
    topic: z.string(),
    channel: z.enum(["email", "slack"]),
    enabled: z.boolean()
  }),
  permission: "employee",
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertNotificationPreference(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().build() as never
      )
    );
  }
});

/**
 * Get account
 *
 * @mcp read
 */
export const getAccount = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: "employee",
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAccount(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Return the connected user's own profile (id, email, name)
 *
 * @mcp read
 */
export const getCurrentUser = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: "employee",
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCurrentUser(ctx.asCaller.supabase, ctx.auditUserId)
    );
  }
});

/**
 * Get all attribute categories
 *
 * @mcp read
 */
export const getAllAttributeCategories = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: "employee",
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getAllAttributeCategories(
        ctx.asCaller.supabase,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get attribute category with values
 *
 * @mcp read
 */
export const getAttributeCategoryWithValues = defineServiceFn({
  input: z.looseObject({ categoryId: z.string() }),
  permission: "employee",
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAttributeCategoryWithValues(
        ctx.asCaller.supabase,
        input.categoryId as never,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Update public account
 *
 * @mcp
 */
export const updatePublicAccount = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    about: z.string().optional(),
    phone: z.string().optional()
  }),
  permission: "employee",
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updatePublicAccount(ctx.asCaller.supabase, input as never)
    );
  }
});
