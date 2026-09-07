/**
 * Carbon Learn — Administration challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/**
 * `admin-create-employee-type` — requirements, in curriculum order:
 * `type-exists`, `type-has-permission`.
 *
 * `employeeType` carries no `createdBy`, so the reader scopes on company plus
 * the challenge's start time. That is looser than the other checkers by
 * necessity, not by oversight — the column simply is not there.
 */
export async function checkCreateEmployeeType({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const types = await reader.employeeTypesCreatedSince(scope);

  if (types.length === 0) {
    return fail(
      "type-exists",
      "No employee type created in this company since you started this challenge. Create one and check again."
    );
  }

  const grants = await reader.employeeTypeGrantCount(
    types.map((type) => type.id)
  );

  const permissioned = types.find((type) => (grants[type.id] ?? 0) >= 1);
  if (!permissioned) {
    return fail(
      "type-has-permission",
      `${types[0].name || "That employee type"} grants nothing yet — tick at least one module permission, or anyone assigned to it can see nothing`
    );
  }

  return {
    passed: true,
    evidence: {
      employeeTypeId: permissioned.id,
      name: permissioned.name,
      modulesGranted: grants[permissioned.id] ?? 0
    }
  };
}

/**
 * `admin-add-custom-field` — requirements, in curriculum order:
 * `field-exists`, `field-active`.
 */
export async function checkAddCustomField({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const fields = await reader.customFieldsCreatedBy(scope);

  if (fields.length === 0) {
    return fail(
      "field-exists",
      "No custom field created by you since you started this challenge. Add one on any table and check again."
    );
  }

  const active = fields.find((field) => field.active);
  if (!active) {
    return fail(
      "field-active",
      `${fields[0].name || "Your custom field"} is inactive — an inactive field never appears on the form`
    );
  }

  return {
    passed: true,
    evidence: {
      customFieldId: active.id,
      name: active.name,
      table: active.table
    }
  };
}

/**
 * `admin-invite-and-permission` (capstone) — requirements, in curriculum order:
 * `type-exists`, `invite-exists`, `invite-has-permissions`.
 *
 * The invitation is checked for permissions rather than for a link to the
 * employee type: an invite stores the flattened grants, not the type it was
 * built from, so the type is what the access CAME from and the invite is what
 * the new person will actually get.
 */
export async function checkInviteAndPermission({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const types = await reader.employeeTypesCreatedSince(scope);

  if (types.length === 0) {
    return fail(
      "type-exists",
      "No employee type created in this company since you started this challenge — decide what access the role needs first."
    );
  }

  const invites = await reader.invitesCreatedBy(scope);
  if (invites.length === 0) {
    return fail(
      "invite-exists",
      "Nobody has been invited yet — send the invitation from People."
    );
  }

  const permissioned = invites.find((invite) => invite.permissionCount > 0);
  if (!permissioned) {
    return fail(
      "invite-has-permissions",
      `The invitation to ${invites[0].email || "that address"} carries no permissions — they would sign in able to do nothing`
    );
  }

  return {
    passed: true,
    evidence: {
      employeeTypeId: types[0].id,
      inviteId: permissioned.id,
      email: permissioned.email,
      permissionsGranted: permissioned.permissionCount
    }
  };
}
