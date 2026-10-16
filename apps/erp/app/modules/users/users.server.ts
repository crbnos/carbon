// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Re-exported, not reimplemented: this module used to carry a near-identical
// copy that (a) missed the canonical version's cache TTL and (b) bypassed its
// per-request memoization.
import { defineServiceFn } from "@carbon/api/service-fn.server";
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
  requiresItarEntityCertification
} from "@carbon/utils";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  deleteGroup,
  insertGroup,
  upsertGroup,
  upsertGroupMembers
} from "~/modules/users/users.service";
import {
  createOperatorValidator,
  employeeTypePermissionsValidator,
  itarEntityCertificationValidator,
  itarUserCertificationValidator,
  userPermissionsValidator
} from "./users.models";
import {
  createConsoleOperator,
  createCustomerAccount,
  createEmployeeAccount,
  createSupplierAccount,
  emailAccountInvite,
  firstIssue,
  getSsoInviteDomainError,
  inviteSender,
  permissionsWriteError,
  recordItarCertification,
  refuseUnlessPermissionsFeature,
  sendInviteEmail
} from "./users.service";

const logger = getLogger("erp", "users");
// Returns false if the auth identity for this userId has been deleted, leaving only an app-side row.
// Creates the auth user for email, or recovers the existing ID if a prior deletion left one behind.
// ---------------------------------------------------------------------------
// Operations (`defineServiceFn`): what the routes, the API and MCP all run
// ---------------------------------------------------------------------------
//
// None of these are published yet. The ones that send an invite or write an
// audit record take the request's IP, city and user agent as input, which an
// API caller could set to anything; the permission editors write that IP into
// the permission audit log. They wait for a context that carries the request.

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
 * domains is refused (a `rule` error). A deactivated or still-invited person
 * is re-added (see `createEmployeeAccount`).
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
      return ctx.error(
        "validation",
        "You must confirm a reasonable basis that this individual is a U.S. person"
      );
    }

    const ssoDomainError = await getSsoInviteDomainError(
      ctx.asSystem.supabase,
      companyId,
      input.email
    );
    if (ssoDomainError) return ctx.error("rule", ssoDomainError);

    const created = await createEmployeeAccount(client, {
      email: input.email.toLowerCase(),
      firstName: input.firstName,
      lastName: input.lastName,
      employeeType,
      locationId: input.locationId,
      companyId,
      createdBy: ctx.auditUserId,
      attestedBy: CONTROLLED_ENVIRONMENT ? ctx.auditUserId : null,
      attestedAt: CONTROLLED_ENVIRONMENT ? datetime.timestamp() : null
    });
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create employee account",
        created
      );
    }

    const sender = await inviteSender(ctx);
    if (!sender) return ctx.error("internal", "Failed to load company or user");
    await sendInviteEmail(ctx, {
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
    const created = await createCustomerAccount(ctx.asCaller.supabase, {
      id: customerContactId,
      customerId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create customer account",
        created
      );
    }
    return emailAccountInvite(ctx, created, origin);
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
    const created = await createSupplierAccount(ctx.asCaller.supabase, {
      id: supplierContactId,
      supplierId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create supplier account",
        created
      );
    }
    return emailAccountInvite(ctx, created, origin);
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

    await sendInviteEmail(ctx, {
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
    const gated = await refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const result = await updateEmployee(ctx.asCaller.supabase, {
      id,
      employeeType,
      permissions,
      companyId: ctx.company.id,
      actorId: ctx.auditUserId,
      ip
    });
    if (!result.success) return permissionsWriteError(ctx, result.message);
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
    const gated = await refuseUnlessPermissionsFeature(ctx);
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
    const gated = await refuseUnlessPermissionsFeature(ctx);
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
    const gated = await refuseUnlessPermissionsFeature(ctx);
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
    const created = await insertGroup(client, {
      name,
      companyId: ctx.company.id
    });
    const groupId = created.data?.id;
    if (created.error || !groupId) {
      return ctx.error("internal", "Failed to insert group", created.error);
    }

    const members = await upsertGroupMembers(client, groupId, selections);
    if (members.error) {
      await deleteGroup(client, groupId);
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
      upsertGroup(client, { id, name, companyId: ctx.company.id }),
      upsertGroupMembers(client, id, selections)
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

    const created = await createConsoleOperator(ctx.asCaller.supabase, {
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
      return ctx.error("validation", firstIssue(parsed.error));
    }
    return recordItarCertification(ctx, {
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
      return ctx.error("validation", firstIssue(parsed.error));
    }
    return recordItarCertification(ctx, {
      type: "user",
      fullLegalName: parsed.data.fullLegalName,
      ipAddress,
      userAgent
    });
  }
});
