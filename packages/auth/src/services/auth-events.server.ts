// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";

const log = getLogger("auth", "events");

/**
 * Recorded as the actor when a permission/role change has no attributable human
 * — an automated job, a replay, or a system-initiated revocation. NIST 800-171
 * 3.3.2 requires every audited action to be traceable to an identity; a blank
 * actor is a traceability gap, so an unattributed change is stamped `system`
 * rather than omitted.
 */
export const SYSTEM_ACTOR = "system";

export type AuthEvent =
  | "login_success"
  | "login_failed"
  | "login_rate_limited"
  | "login_locked"
  | "magic_link_sent"
  | "mfa_challenge_success"
  | "mfa_challenge_failed"
  | "permission_denied"
  | "permission_changed"
  | "role_changed"
  | "role_access_changed"
  | "logout";

/**
 * Emit a structured authentication / authorization event
 * (NIST 800-171 3.3.1 / 3.3.2 / AU-2 / AU-3).
 *
 * The application audit log records only business-entity CRUD; identity events
 * (login, logout, failed login, MFA challenge, permission denial) are captured
 * here instead. `@carbon/logger` ships to CloudWatch in production with field
 * redaction and request-id correlation, giving the org's security staff an
 * account + IP + outcome trail. `authEvent` is a stable field for CloudWatch
 * metric filters / SIEM alerting.
 *
 * The authenticating identity is carried under `actor` (NOT `email`): the logger
 * redacts a field literally named `email`, but an audit record must retain who
 * acted. `actor` is a deliberate, non-redacted identity field for that purpose.
 */
export function logAuthEvent(
  event: AuthEvent,
  fields: {
    /** The account that acted — email or userId. Deliberately not redacted. */
    actor?: string;
    userId?: string;
    ip?: string;
    companyId?: string;
    reason?: string;
    outcome?: "success" | "failure";
    [key: string]: unknown;
  }
): void {
  const failed =
    event === "login_failed" ||
    event === "login_rate_limited" ||
    event === "login_locked" ||
    event === "mfa_challenge_failed" ||
    event === "permission_denied";
  const outcome = fields.outcome ?? (failed ? "failure" : "success");
  const payload = { authEvent: event, outcome, ...fields };
  // Append the identity fields to the human-readable message so they are visible
  // in the dev ANSI console (whose formatter renders only the message, not the
  // structured properties). The properties above remain the machine-readable
  // source of truth for JSONL / CloudWatch — this line is a readable echo, not a
  // replacement.
  const target = fields.targetUserId;
  const message =
    `auth.${event}` +
    (fields.actor != null ? ` actor=${fields.actor}` : "") +
    (target != null ? ` target=${String(target)}` : "") +
    (fields.ip != null ? ` ip=${fields.ip}` : "") +
    (fields.outcome != null || failed ? ` outcome=${outcome}` : "");
  if (outcome === "failure") {
    log.warn(message, payload);
  } else {
    log.info(message, payload);
  }
}

/**
 * The keys a user holds in ONE company, from a key → company ids map: a
 * person's `<page>_<action>` keys (`claimKeys`) or a portal account's
 * `userPermission` keys. Sorted, so a before/after diff is stable.
 */
export function grantedPermissionKeys(
  permissions: Record<string, string[]> | null | undefined,
  companyId: string
): string[] {
  if (!permissions) return [];
  return Object.entries(permissions)
    .filter(
      ([, companies]) =>
        Array.isArray(companies) && companies.includes(companyId)
    )
    .map(([key]) => key)
    .sort();
}

/**
 * Emit a `permission_changed` audit event (NIST 800-171 3.3.1 / 3.3.2 / AC-6).
 *
 * Records WHO changed WHOSE permissions in which company, plus the before/after
 * grant set for that company and the derived `granted` / `revoked` deltas.
 * Emitted by `writeAccessGrants` (`@carbon/ee/permissions.server`) when a
 * person's access changes, whether from the access editor or the
 * `update-permissions` job.
 */
export function logPermissionChange(fields: {
  /** The acting admin's userId. Falls back to {@link SYSTEM_ACTOR} when absent. */
  actor?: string | null;
  /** The user whose permissions changed. */
  targetUserId: string;
  companyId: string;
  before: Record<string, string[]> | null | undefined;
  after: Record<string, string[]> | null | undefined;
  /** Source IP of the request that made the change (AU-3 "source of event"). */
  ip?: string | null;
  reason?: string;
}): void {
  const before = grantedPermissionKeys(fields.before, fields.companyId);
  const after = grantedPermissionKeys(fields.after, fields.companyId);
  logAuthEvent("permission_changed", {
    actor: fields.actor ?? SYSTEM_ACTOR,
    targetUserId: fields.targetUserId,
    companyId: fields.companyId,
    ip: fields.ip ?? undefined,
    before,
    after,
    granted: after.filter((key) => !before.includes(key)),
    revoked: before.filter((key) => !after.includes(key)),
    reason: fields.reason
  });
}

/** One module or page whose grant moved; `"inherit"` when there was or is no grant. */
export type GrantChange = {
  module: string;
  page: string | null;
  from: string;
  to: string;
};

/**
 * Emit a `role_access_changed` audit event (NIST 800-171 3.3.1 / 3.3.2 / AC-6):
 * who changed which grants of an employee type, and how many employees hold it.
 */
export function logRoleAccessChange(fields: {
  actor?: string | null;
  employeeTypeId: string;
  companyId: string;
  changes: GrantChange[];
  /** The employees whose access the change moved. */
  affected: number;
  ip?: string | null;
}): void {
  logAuthEvent("role_access_changed", {
    actor: fields.actor ?? SYSTEM_ACTOR,
    employeeTypeId: fields.employeeTypeId,
    companyId: fields.companyId,
    ip: fields.ip ?? undefined,
    changes: fields.changes,
    affected: fields.affected
  });
}

/**
 * Emit a `permission_changed` audit event for an API key (NIST 800-171 3.3.1 /
 * 3.3.2 / AC-6): who changed which grants of the key.
 */
export function logApiKeyAccessChange(fields: {
  actor?: string | null;
  apiKeyId: string;
  companyId: string;
  changes: GrantChange[];
  ip?: string | null;
}): void {
  logAuthEvent("permission_changed", {
    actor: fields.actor || SYSTEM_ACTOR,
    apiKeyId: fields.apiKeyId,
    companyId: fields.companyId,
    ip: fields.ip ?? undefined,
    changes: fields.changes
  });
}

/** One `permission` row as an audit event records it. */
export type AuditGrant = { module: string; page: string | null; level: string };

/**
 * Emit a `role_changed` audit event (NIST 800-171 3.3.1 / 3.3.2 / AC-2).
 *
 * Records a change to a user's company role/membership — notably deactivation,
 * where the role transitions to `null` and the company is stripped from every
 * permission array. When `before`/`after` permission maps are supplied, the
 * per-company grant summary and the `revoked` delta are attached for the audit
 * trail (deactivation revokes access as well as removing the role).
 */
export function logRoleChange(fields: {
  /** The acting admin's userId. Falls back to {@link SYSTEM_ACTOR} when absent. */
  actor?: string | null;
  /** The user whose role changed. */
  targetUserId: string;
  companyId: string;
  beforeRole?: string | null;
  afterRole?: string | null;
  before?: Record<string, string[]> | null;
  after?: Record<string, string[]> | null;
  /**
   * An employee's own `permission` rows before and after, recorded instead of
   * `before`/`after` (which read the legacy `userPermission` keys).
   */
  grantsBefore?: AuditGrant[];
  grantsAfter?: AuditGrant[];
  /** Source IP of the request that made the change (AU-3 "source of event"). */
  ip?: string | null;
  reason?: string;
}): void {
  const payload: Record<string, unknown> = {
    actor: fields.actor ?? SYSTEM_ACTOR,
    targetUserId: fields.targetUserId,
    companyId: fields.companyId,
    ip: fields.ip ?? undefined,
    beforeRole: fields.beforeRole ?? null,
    afterRole: fields.afterRole ?? null,
    reason: fields.reason
  };

  if (fields.before !== undefined || fields.after !== undefined) {
    const before = grantedPermissionKeys(fields.before, fields.companyId);
    const after = grantedPermissionKeys(fields.after, fields.companyId);
    payload.before = before;
    payload.after = after;
    payload.revoked = before.filter((key) => !after.includes(key));
  }

  if (fields.grantsBefore !== undefined || fields.grantsAfter !== undefined) {
    const before = fields.grantsBefore ?? [];
    const after = fields.grantsAfter ?? [];
    const same = (a: AuditGrant, b: AuditGrant) =>
      a.module === b.module && a.page === b.page && a.level === b.level;
    payload.before = before;
    payload.after = after;
    payload.revoked = before.filter((g) => !after.some((a) => same(a, g)));
  }

  logAuthEvent("role_changed", payload);
}
