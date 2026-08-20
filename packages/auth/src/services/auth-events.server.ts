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
 * The permission keys (`${module}_${action}`) a user effectively holds in ONE
 * company, derived from the `userPermission.permissions` map — each key maps to
 * the list of company ids it is granted for, so a key is "held" when that list
 * includes `companyId`. Returned sorted so a before/after diff is stable and two
 * equal sets serialise identically. This is the compact, human-readable audit
 * projection of the full cross-company permission blob (which is large and noisy).
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
 * grant set for that company and the derived `granted` / `revoked` deltas. Used
 * by the granular permission-edit path (the `update-permissions` batch job).
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

  logAuthEvent("role_changed", payload);
}
