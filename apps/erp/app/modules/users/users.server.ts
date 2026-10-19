// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { accountProfileValidator } from "@carbon/account";
import { defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import { CarbonEdition, CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { deactivateUser } from "@carbon/auth/users.server";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { generateConsolePin, setEmployeePin } from "@carbon/ee/console.server";
import {
  insertEmployeeType,
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
  requiresItarEntityCertification
} from "@carbon/utils";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
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
// The writes that send an invite or write an audit record are not published
// (no `@mcp`): they take the request's IP, city and user agent as input, which
// an API caller could set to anything, and the permission editors write that IP
// into the permission audit log. They wait for a context that carries the
// request.

/** Where the request came from, as the route read it from its headers. */
const requestOrigin = {
  ip: z.string().optional(),
  city: z.string().optional()
};
/**
 * Invite an employee: create their account in the company and email them
 * the invite link.
 *
 * @remarks
 * Without role authoring (the PERMISSIONS feature), the invite always gets
 * the Admin employee type, whatever was asked for. In a controlled
 * environment the inviter must attest the person is a U.S. person (a
 * `validation` error otherwise). Once SSO is on, an email outside its
 * domains is refused (a `rule` error, its only one). A deactivated or
 * still-invited person is re-added (see `createEmployeeAccount`).
 */
export const inviteEmployee = defineServiceFn({
  input: z.object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    employeeType: z.string().min(1),
    locationId: z.string().min(1),
    usPersonAttestation: z.boolean().default(false),
    ...requestOrigin
  }),
  permission: { create: "users" },
  async run(ctx, input) {
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
      name: `${input.firstName} ${input.lastName}`.trim(),
      ip: input.ip,
      city: input.city
    });
    return { userId: created.userId };
  }
});
/**
 * Invite a customer contact: create their portal account and email them the
 * invite link.
 */
export const inviteCustomerContact = defineServiceFn({
  input: z.object({
    customerContactId: z.string().min(1),
    customerId: z.string().min(1),
    ...requestOrigin
  }),
  permission: { create: "users" },
  async run(ctx, { customerContactId, customerId, ...origin }) {
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
    return service.emailAccountInvite(ctx, created, origin);
  }
});

/**
 * Invite a supplier contact: create their portal account and email them the
 * invite link.
 */
export const inviteSupplierContact = defineServiceFn({
  input: z.object({
    supplierContactId: z.string().min(1),
    supplierId: z.string().min(1),
    ...requestOrigin
  }),
  permission: { create: "users" },
  async run(ctx, { supplierContactId, supplierId, ...origin }) {
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
    return service.emailAccountInvite(ctx, created, origin);
  }
});

/**
 * Send pending invites again.
 *
 * @remarks
 * One user is re-invited at once: the invite gets a new code (the old link
 * stops working), its acceptance and revocation are cleared, and its
 * `createdAt` restarts the controlled-environment expiry. Several are queued
 * as a job (`queued: true`). Refused when the user has no invite here.
 */
export const resendInvites = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1),
    ...requestOrigin
  }),
  permission: { create: "users" },
  async run(ctx, { userIds, ip, city }) {
    const companyId = ctx.company.id;
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
      name: user.data.fullName ?? "",
      ip,
      city
    });
    return { queued: false };
  }
});

/**
 * Revoke pending invites, and take the users' access to the company away.
 *
 * @remarks
 * One user is deactivated at once (and, on Cloud, the subscription's seat
 * count updated); several are deactivated by a job. Then every open invite
 * of theirs here is marked revoked, and each revocation is written to the
 * audit log when the company keeps one.
 */
export const revokeInvites = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1),
    ip: z.string().optional(),
    userAgent: z.string().optional()
  }),
  permission: { create: "users" },
  async run(ctx, { userIds, ip, userAgent }) {
    const companyId = ctx.company.id;
    const actorId = ctx.auditUserId;
    const serviceRole = ctx.asSystem.supabase;

    const users = await serviceRole
      .from("user")
      .select("id, email")
      .in("id", userIds);
    if (users.error) {
      return ctx.error("internal", "Failed to load users", users.error);
    }

    if (users.data.length === 1) {
      const deactivated = await deactivateUser(
        serviceRole,
        users.data[0].id,
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
        userIds.map((id) => ({
          payload: { id, type: "deactivate" as const, companyId, actorId, ip }
        }))
      );
    }

    const revokedAt = datetime.timestamp();
    const revoked = await serviceRole
      .from("invite")
      .update({ revokedAt })
      .in(
        "email",
        users.data.map((user) => user.email)
      )
      .eq("companyId", companyId)
      .is("revokedAt", null)
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
        logger.warn("[revoke-invite] audit write skipped", { error: err });
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
 * Refuses the caller's own account. One user is deactivated at once, and
 * `message` says how it went; several are deactivated by a job
 * (`queued: true`).
 */
export const deactivateUsers = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1),
    ip: z.string().optional()
  }),
  permission: { delete: "users" },
  async run(ctx, { userIds, ip }) {
    const companyId = ctx.company.id;
    const actorId = ctx.auditUserId;
    if (userIds.includes(actorId)) {
      return ctx.error("rule", "You cannot deactivate yourself");
    }

    if (userIds.length === 1) {
      // The service role: "userPermission" has no UPDATE policy, so under the
      // caller's client the permission strip matched no rows and the user
      // kept every grant for this company. It also updates the Stripe seats.
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
 * must both be the company's, and the caller must be a claims admin. The
 * change is written to the permission audit log.
 */
export const updateEmployeePermissions = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    employeeType: z.string().min(1),
    permissions: companyPermissions,
    ip: z.string().optional()
  }),
  permission: { update: "users" },
  async run(ctx, { id, employeeType, permissions, ip }) {
    const gated = await service.refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const result = await updateEmployee(ctx.asCaller.supabase, {
      id,
      employeeType,
      permissions,
      companyId: ctx.company.id,
      actorId: ctx.auditUserId,
      ip
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
 * employee of the company. `editType: "add"` only grants; any other value
 * also takes away what `permissions` leaves unchecked.
 */
export const bulkUpdatePermissions = defineServiceFn({
  input: z.object({
    editType: z.string().min(1),
    userIds: z.array(z.string().min(1)).min(1),
    permissions: companyPermissions,
    ip: z.string().optional()
  }),
  permission: { update: "users" },
  async run(ctx, { editType, userIds, permissions, ip }) {
    const gated = await service.refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const companyId = ctx.company.id;
    // The job writes these users' grants as the service role: every id must
    // be an employee of this company. One batched read.
    const uniqueUserIds = [...new Set(userIds)];
    const members = await ctx.asSystem.supabase
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
      return ctx.error("notFound", "Employee not found");
    }

    await batchTrigger(
      "update-permissions",
      userIds.map((id) => ({
        payload: {
          id,
          permissions,
          addOnly: editType === "add",
          companyId,
          actorId: ctx.auditUserId,
          ip
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
 * Needs role authoring (the PERMISSIONS feature). The type and its
 * permissions are two writes: when the permissions fail, the type stays.
 */
export const createEmployeeType = defineServiceFn({
  input: z.object({
    name: z.string().trim().min(1),
    permissions: employeeTypePermissionsValidator
  }),
  permission: { create: "users" },
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
 * Needs role authoring (the PERMISSIONS feature). Two writes, as for
 * `createEmployeeType`.
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

const groupMembers = z.array(z.string().min(1)).min(1);

/**
 * Create a group with its members: users (`user_<id>`) and groups
 * (`group_<id>`). When the members cannot be saved, the group is removed.
 */
export const createGroup = defineServiceFn({
  input: z.object({ name: z.string().trim().min(1), selections: groupMembers }),
  permission: { create: "users" },
  async run(ctx, { name, selections }) {
    const client = ctx.asCaller.supabase;
    const created = await service.insertGroup(client, {
      name,
      companyId: ctx.company.id
    });
    const groupId = created.data?.id;
    if (created.error || !groupId) {
      return ctx.error("internal", "Failed to insert group", created.error);
    }

    const members = await service.upsertGroupMembers(
      client,
      groupId,
      selections
    );
    if (members.error) {
      await service.deleteGroup(client, groupId);
      return ctx.error(
        "internal",
        "Failed to insert group members",
        members.error
      );
    }
    return { id: groupId };
  }
});

/** Rename a group and replace its members. */
export const updateGroup = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    selections: groupMembers
  }),
  // The route has only ever required view; row-level security decides the
  // write. Kept as it was, so this stays unpublished.
  permission: { view: "users" },
  async run(ctx, { id, name, selections }) {
    const client = ctx.asCaller.supabase;
    const [group, members] = await Promise.all([
      service.upsertGroup(client, { id, name, companyId: ctx.company.id }),
      service.upsertGroupMembers(client, id, selections)
    ]);
    if (group.error) {
      return ctx.error("internal", "Failed to update group", group.error);
    }
    if (members.error) {
      return ctx.error(
        "internal",
        "Failed to update group members",
        members.error
      );
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

/** Where a certification was signed, as the route read it. */
const signedFrom = {
  ipAddress: z.string().optional(),
  userAgent: z.string().optional()
};
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
    complianceContact: z.string(),
    ...signedFrom
  }),
  permission: { update: "users" },
  async run(ctx, { ipAddress, userAgent, ...form }) {
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
      ipAddress,
      userAgent
    });
  }
});

/** Certify that the caller is a U.S. person, for the controlled environment. */
export const certifyItarUser = defineServiceFn({
  input: z.object({
    certifyUsPerson: z.boolean(),
    agreeNotify: z.boolean(),
    understandPenalty: z.boolean(),
    fullLegalName: z.string(),
    ...signedFrom
  }),
  permission: {},
  async run(ctx, { ipAddress, userAgent, ...form }) {
    const parsed = itarUserCertificationValidator.safeParse(form);
    if (!parsed.success) {
      return ctx.error("validation", service.firstIssue(parsed.error));
    }
    return service.recordItarCertification(ctx, {
      type: "user",
      fullLegalName: parsed.data.fullLegalName,
      ipAddress,
      userAgent
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
    const updated = await client
      .from("user")
      .update({ flags: { ...flags, [flag]: value } })
      .eq("id", userId);
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
