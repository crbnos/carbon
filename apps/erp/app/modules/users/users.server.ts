// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { accountProfileValidator } from "@carbon/account";
import { defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import { CarbonEdition, CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { deactivateUser } from "@carbon/auth/users.server";
import type { Json } from "@carbon/database";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { generateConsolePin, setEmployeePin } from "@carbon/ee/console.server";
import {
  insertEmployeeType,
  makeCompanyPermissionsFromClaims,
  updateEmployee,
  upsertEmployeeType,
  upsertEmployeeTypePermissions
} from "@carbon/ee/permissions.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { batchTrigger } from "@carbon/jobs";
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
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  refuseKeyWithout,
  refuseUnlessOwned
} from "~/modules/shared/shared.service";
import {
  bulkPermissionEditTypes,
  createOperatorValidator,
  employeeTypePermissionsValidator,
  itarEntityCertificationValidator,
  itarUserCertificationValidator,
  US_PERSON_ATTESTATION_REQUIRED,
  userFlagValidator,
  userPermissionsValidator
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
 * employee type, whatever was asked for. A first-time invite writes the
 * employee under the caller's permissions, so it needs `update: users` and
 * `create: people` as well; an API key without them is refused. In a
 * controlled environment the inviter must attest the person is a U.S.
 * person (a `validation` error otherwise). Once SSO is on, an email outside
 * its domains is refused (a `rule` error). A deactivated or still-invited
 * person is invited again: a new code, and the link already sent stops
 * working. Returns the new employee's user id.
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
  permission: { create: "users" },
  async run(ctx, input) {
    const keyRefused = refuseKeyWithout(ctx, {
      update: "users",
      create: "people"
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
 * written under the caller's permissions, so the caller also needs `view`,
 * `create` and `update: sales`. Returns the new account's user id.
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
  permission: { create: "users" },
  async run(ctx, { customerContactId, customerId }) {
    const refused = service.refuseUnlessCan(ctx, {
      view: "sales",
      create: "sales",
      update: "sales"
    });
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
 * written under the caller's permissions, so the caller also needs `view`,
 * `create` and `update: purchasing`. Returns the new account's user id.
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
  permission: { create: "users" },
  async run(ctx, { supplierContactId, supplierId }) {
    const refused = service.refuseUnlessCan(ctx, {
      view: "purchasing",
      create: "purchasing",
      update: "purchasing"
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
 * moments later. Refused, for every user, when one has no invite here (a
 * `notFound` error), has an active account in the company, or was a customer
 * or supplier contact whose account was deactivated (a `rule` error; invite
 * that contact again with users_inviteCustomerContact or
 * users_inviteSupplierContact).
 *
 * @param userIds - The users to invite again, at least one. See users_getEmployees (status Invited or Inactive), users_getCustomers and users_getSuppliers.
 *
 * @mcp
 */
export const resendInvites = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1)
  }),
  permission: { create: "users" },
  async run(ctx, { userIds }) {
    const companyId = ctx.company.id;
    const { ip, city } = ctx.origin;
    const refused = await service.refuseUnlessReinvitable(ctx, userIds);
    if (refused) return refused;
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
              ip: ip ?? "127.0.0.1"
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

    const existingInvite = await serviceRole
      .from("invite")
      .select("createdBy")
      .eq("email", user.data.email)
      .eq("companyId", companyId)
      .maybeSingle();
    if (existingInvite.error || !existingInvite.data) {
      return ctx.error(
        "notFound",
        "No invite record found for user",
        existingInvite.error
      );
    }

    const refreshed = await serviceRole
      .from("invite")
      .update({
        code: nanoid(),
        acceptedAt: null,
        revokedAt: null,
        createdAt: datetime.timestamp()
      })
      .eq("email", user.data.email)
      .eq("companyId", companyId)
      .select("code")
      .single();
    if (refreshed.error || !refreshed.data) {
      return ctx.error("internal", "Failed to refresh invite", refreshed.error);
    }

    const inviter = await serviceRole
      .from("user")
      .select("email, fullName")
      .eq("id", existingInvite.data.createdBy)
      .single();

    await service.sendInviteEmail(ctx, {
      companyName: company.data.name,
      invitedBy: {
        email: inviter.data?.email ?? user.data.email,
        fullName: inviter.data?.fullName ?? null
      },
      email: user.data.email,
      code: refreshed.data.code,
      name: user.data.fullName ?? ""
    });
    return { queued: false };
  }
});

/**
 * Revoke pending invites, so the links already sent stop working.
 *
 * @remarks
 * Revoking deactivates the user, so it needs `delete: users`, as the lists'
 * Revoke Invite does. Only a pending invite is revoked: every user must have
 * an invite here that is neither accepted nor revoked, and no membership in
 * the company (an active account is deactivated with users_deactivateUsers).
 * One user is deactivated at once (and, on Cloud, the subscription's seat
 * count updated); several are deactivated by a job. Then every pending
 * invite of theirs here is marked revoked, and each revocation is written to
 * the audit log when the company keeps one. Returns how many invites were
 * revoked.
 *
 * @param userIds - The invited users, from 1 to 100. See users_getEmployees (status Invited) and users_getUnrevokedInviteEmails.
 *
 * @mcp destructive
 */
export const revokeInvites = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1).max(100)
  }),
  permission: { delete: "users" },
  async run(ctx, { userIds }) {
    const companyId = ctx.company.id;
    const actorId = ctx.auditUserId;
    const serviceRole = ctx.asSystem.supabase;
    const { ip, userAgent } = ctx.origin;

    // The pending invite ids are read before deactivating: deactivateUser
    // stamps the invite revoked itself.
    const pending = await service.refuseUnlessPendingInvites(ctx, userIds);
    if (pending.error) return pending.error;
    const { users, inviteIds } = pending.data;

    if (users.length === 1) {
      const deactivated = await deactivateUser(
        serviceRole,
        users[0].id,
        companyId,
        actorId,
        ip
      );
      if (!deactivated.success) {
        return ctx.error(
          "internal",
          "Failed to deactivate user",
          deactivated.message
        );
      }
      if (CarbonEdition === Edition.Cloud) {
        await updateSubscriptionQuantityForCompany(companyId);
      }
    } else {
      await batchTrigger(
        "user-admin",
        users.map(({ id }) => ({
          payload: { id, type: "deactivate" as const, companyId, actorId, ip }
        }))
      );
    }

    // An invite accepted since it was read is not stamped revoked.
    const revokedAt = datetime.timestamp();
    const revoked = await serviceRole
      .from("invite")
      .update({ revokedAt })
      .in("id", inviteIds)
      .eq("companyId", companyId)
      .is("acceptedAt", null)
      .select("id");
    if (revoked.error) {
      return ctx.error("internal", "Failed to revoke invites", revoked.error);
    }

    // Best effort: a company without audit logging has no audit log table.
    if (revoked.data.length > 0) {
      try {
        await insertAuditLogEntries(
          serviceRole,
          companyId,
          revoked.data.map((invite) => ({
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
    return { revoked: revoked.data.length };
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
 * caller's own account, and a user with no membership, account or invite in
 * the company (a `notFound` error). One user is deactivated at once, and `message` says how it
 * went; several are deactivated by a job (`queued: true`) a few moments
 * later. To give an employee access back, send the invite again
 * (users_resendInvites); a customer or supplier contact is invited again
 * with users_inviteCustomerContact or users_inviteSupplierContact.
 *
 * @param userIds - The users to deactivate, at least one. See users_getEmployees, users_getCustomers and users_getSuppliers.
 *
 * @mcp destructive
 */
export const deactivateUsers = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1)
  }),
  permission: { delete: "users" },
  async run(ctx, { userIds }) {
    const companyId = ctx.company.id;
    const { ip } = ctx.origin;
    const actorId = ctx.auditUserId;
    if (userIds.includes(actorId)) {
      return ctx.error("rule", "You cannot deactivate yourself");
    }
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

const companyPermissions = z.record(z.string(), userPermissionsValidator);
/**
 * Change an employee's employee type and their permissions in the company.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). The employee and the type
 * must both be the company's. The type is saved first: when the permissions
 * then fail, the type stays. A new type does not bring its permissions:
 * send them in `permissions` (users_getPermissionsByEmployeeType lists a
 * type's). The change takes effect at once and is written to the permission
 * audit log.
 *
 * @param id - The employee's user id. See users_getEmployees.
 * @param employeeType - The employee type to give the employee. See users_getEmployeeTypes.
 * @param permissions - Keyed by module in lower case (see users_getModules): its view, create, update and delete grants. Each grant is set as sent, true or false. A module left out keeps its grants. users_getEmployeePermissions returns the employee's grants in this shape.
 *
 * @mcp
 */
export const updateEmployeePermissions = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    employeeType: z.string().min(1),
    permissions: companyPermissions
  }),
  permission: { update: "users" },
  async run(ctx, { id, employeeType, permissions }) {
    const gated = await service.refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const result = await updateEmployee(ctx.asCaller.supabase, {
      id,
      employeeType,
      permissions,
      companyId: ctx.company.id,
      actorId: ctx.auditUserId,
      ip: ctx.origin.ip
    });
    if (!result.success)
      return service.permissionsWriteError(ctx, result.message);
    return { id };
  }
});

/**
 * Change several employees' permissions in the company, in a job.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). Every user must be an
 * employee of the company. The call only queues one job per user (`count`):
 * the permissions change a few moments later, and each change is written to
 * the permission audit log. users_getEmployeePermissions shows an
 * employee's grants: read it before a step that needs the new ones.
 *
 * @param editType - `add` only grants what `permissions` marks true. `update` also takes away what it marks false.
 * @param userIds - The employees, at least one. See users_getEmployees.
 * @param permissions - Keyed by module in lower case (see users_getModules): its view, create, update and delete grants. A module left out keeps its grants.
 *
 * @mcp
 */
export const bulkUpdatePermissions = defineServiceFn({
  input: z.object({
    editType: z.enum(bulkPermissionEditTypes),
    userIds: z.array(z.string().min(1)).min(1),
    permissions: companyPermissions
  }),
  permission: { update: "users" },
  async run(ctx, { editType, userIds, permissions }) {
    const gated = await service.refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const companyId = ctx.company.id;
    const outside = await service.refuseUnlessCompanyEmployees(ctx, userIds);
    if (outside) return outside;

    await batchTrigger(
      "update-permissions",
      userIds.map((id) => ({
        payload: {
          id,
          permissions,
          addOnly: editType === "add",
          companyId,
          actorId: ctx.auditUserId,
          ip: ctx.origin.ip
        }
      }))
    );
    return { count: userIds.length };
  }
});

/**
 * Create an employee type with its permissions.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature), and `update: users` beside
 * `create`: row-level security writes an employee type and its permissions
 * only with it. The type and its permissions are two writes: when the
 * permissions fail, the type stays.
 *
 * @param name - The employee type's name.
 * @param permissions - One entry per module: `name` is the module in lower case (see users_getModules), `permission` its view, create, update and delete grants. A module left out grants nothing.
 *
 * @mcp
 */
export const createEmployeeType = defineServiceFn({
  input: z.object({
    name: z.string().trim().min(1),
    permissions: employeeTypePermissionsValidator
  }),
  permission: { create: "users", update: "users" },
  async run(ctx, { name, permissions }) {
    const gated = await service.refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const created = await insertEmployeeType(client, { name, companyId });
    const employeeTypeId = created.data?.id;
    if (created.error || !employeeTypeId) {
      return ctx.error(
        "internal",
        "Failed to insert employee type",
        created.error
      );
    }

    const saved = await upsertEmployeeTypePermissions(
      client,
      employeeTypeId,
      companyId,
      permissions
    );
    if (saved.error) {
      return ctx.error(
        "internal",
        "Failed to insert employee type permissions",
        saved.error
      );
    }
    return { id: employeeTypeId };
  }
});

/**
 * Rename an employee type and change its permissions.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). Refused when the type is
 * not the company's. Two writes, as for `createEmployeeType`. The type's
 * permissions are what a person invited with it gets; an employee who
 * already has the type keeps their own grants (change those with
 * users_bulkUpdatePermissions).
 *
 * @param id - The employee type. See users_getEmployeeTypes.
 * @param name - The employee type's name.
 * @param permissions - One entry per module: `name` is the module in lower case (see users_getModules), `permission` its view, create, update and delete grants. A module left out keeps its grants; send it with every grant false to remove them.
 *
 * @mcp
 */
export const updateEmployeeType = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    permissions: employeeTypePermissionsValidator
  }),
  permission: { update: "users" },
  async run(ctx, { id, name, permissions }) {
    const gated = await service.refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;
    const missing = await refuseUnlessOwned(ctx, "employeeType", { id });
    if (missing) return missing;

    const client = ctx.asCaller.supabase;
    const updated = await upsertEmployeeType(client, { id, name });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update employee type",
        updated.error
      );
    }

    const saved = await upsertEmployeeTypePermissions(
      client,
      id,
      ctx.company.id,
      permissions
    );
    if (saved.error) {
      return ctx.error(
        "internal",
        "Failed to update employee type permissions",
        saved.error
      );
    }
    return { id };
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
 * Needs `update: users` beside `create`: adding members is an update. Members
 * are users (`user_<id>`) and groups (`group_<id>`), each the company's (a
 * `notFound` error otherwise); a member sent twice is saved once. The group
 * and its members are saved together, or neither is.
 *
 * @param name - The group's name.
 * @param selections - The members, at least one: `user_<userId>` (see users_getEmployees) or `group_<groupId>` (see users_getGroups).
 *
 * @mcp
 */
export const createGroup = defineServiceFn({
  input: z.object({ name: z.string().trim().min(1), selections: groupMembers }),
  permission: { create: "users", update: "users" },
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
 * Needs `update: users`. The members sent replace every member the group
 * had, in one write with the name. Each member must be the company's (a
 * `notFound` error otherwise) and a group is never its own member (a
 * `validation` error); a member sent twice is saved once. Refused when the
 * group is not the company's.
 *
 * @param id - The group. See users_getGroups.
 * @param name - The group's name.
 * @param selections - Every member, at least one: `user_<userId>` (see users_getEmployees) or `group_<groupId>` (see users_getGroups).
 *
 * @mcp write
 */
export const updateGroup = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    selections: groupMembers
  }),
  // The route has only ever required view. The write bypasses row-level
  // security, which asked for update, so every actor needs update.
  permission: { view: "users" },
  async run(ctx, { id, name, selections }) {
    const refused = service.refuseUnlessCan(ctx, { update: "users" });
    if (refused) return refused;
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
  permission: { create: "users" },
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
 * A PIN pins in as that person at any MES console, so resetting one hands
 * over their shop-floor identity. Users update covers console operators
 * (PIN-only accounts made for this); for anyone else, an admin included, the
 * caller also needs settings update, the permission that turns console mode
 * on. The PIN is stored only as a hash and returned once.
 */
export const resetConsoleOperatorPin = defineServiceFn({
  input: z.object({ operatorId: z.string().min(1) }),
  permission: { update: "users" },
  async run(ctx, { operatorId }) {
    const user = await ctx.asCaller.supabase
      .from("user")
      .select("id, isConsoleOperator")
      .eq("id", operatorId)
      .single();
    if (user.error || !user.data) {
      return ctx.error("notFound", "Operator not found", user.error);
    }
    if (!user.data.isConsoleOperator && !ctx.can({ update: "settings" })) {
      return ctx.error("forbidden", "You do not have permission to do this");
    }

    // The (employee, company) foreign key refuses an operator outside this
    // company.
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

const RIDER_SIGNER =
  "The Rider must be accepted by a representative of the company it binds.";

/**
 * Accept the ITAR Rider on behalf of the company.
 *
 * @remarks
 * It unblocks the whole company's controlled-environment gate, so it needs
 * users update, and the signer must be a real person of the company: an API
 * key signs as no one, and Carbon staff (who hold users update in companies
 * they set up) cannot bind a customer.
 */
export const certifyItarEntity = defineServiceFn({
  input: z.object({
    authorityToBind: z.boolean(),
    acceptRider: z.boolean(),
    fullLegalName: z.string(),
    title: z.string(),
    complianceContact: z.string()
  }),
  permission: { update: "users" },
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
  permission: {},
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { delete: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
 * Get an employee's permissions in the company: what the employee
 * permissions page shows.
 *
 * @remarks
 * Returns the employee's name and employee type, and `permissions` keyed by
 * module in lower case, each with its view, create, update and delete
 * grants in the company: the shape users_updateEmployeePermissions and
 * users_bulkUpdatePermissions take. The grants are the ones in force, so a
 * users_bulkUpdatePermissions change shows once its job has run. A person
 * whose invite is still pending, or who was deactivated, holds none here.
 * Refused (a `notFound` error) for a user who is not an employee of the
 * company.
 *
 * @param id - The employee's user id. See users_getEmployees.
 *
 * @mcp read
 */
export const getEmployeePermissions = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { view: "users" },
  async run(ctx, { id }) {
    const companyId = ctx.company.id;
    // The service role, as the page reads: under the caller `get_claims`
    // refuses a pending invitee, who has no membership yet. The employee
    // read keeps the answer to this company's employees.
    const serviceRole = ctx.asSystem.supabase;
    const [employee, claims] = await Promise.all([
      serviceRole
        .from("employees")
        .select("id, name, employeeTypeId")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle(),
      service.getClaims(serviceRole, id, companyId)
    ]);
    if (employee.error) {
      return ctx.error(
        "internal",
        "Failed to load the employee",
        employee.error
      );
    }
    if (!employee.data) return ctx.error("notFound", "Employee not found");
    if (claims.error) {
      return ctx.error(
        "internal",
        "Failed to load the employee's permissions",
        claims.error
      );
    }
    const parsed = makeCompanyPermissionsFromClaims(
      claims.data as Json[],
      companyId
    );
    if (!parsed) {
      return ctx.error("internal", "Failed to load the employee's permissions");
    }
    return {
      id,
      name: employee.data.name,
      employeeTypeId: employee.data.employeeTypeId,
      permissions: parsed.permissions
    };
  }
});

/**
 * Get unrevoked invite emails
 *
 * @mcp read
 */
export const getUnrevokedInviteEmails = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
  async run(ctx) {
    return unwrap(ctx, await service.getModules(ctx.asCaller.supabase));
  }
});

/**
 * Get group
 *
 * @mcp read
 */
export const getGroup = defineServiceFn({
  input: z.looseObject({ groupId: z.string() }),
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { view: "users" },
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
  permission: { update: "users" },
  async run(ctx, input) {
    return await service.resolveUserSelectIds(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input.ids).build() as never
    );
  }
});

/**
 * Get permissions by employee type
 *
 * @mcp read
 */
export const getPermissionsByEmployeeType = defineServiceFn({
  input: z.looseObject({ employeeTypeId: z.string() }),
  permission: { view: "users" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPermissionsByEmployeeType(
        ctx.asCaller.supabase,
        input.employeeTypeId as never
      )
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
  permission: { view: "users" },
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
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
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updatePublicAccount(ctx.asCaller.supabase, input as never)
    );
  }
});
