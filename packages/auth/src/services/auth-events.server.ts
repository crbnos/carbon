import { getLogger } from "@carbon/logger";

const log = getLogger("auth", "events");

export type AuthEvent =
  | "login_success"
  | "login_failed"
  | "login_rate_limited"
  | "login_locked"
  | "magic_link_sent"
  | "mfa_challenge_success"
  | "mfa_challenge_failed"
  | "permission_denied"
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
  if (outcome === "failure") {
    log.warn(`auth.${event}`, payload);
  } else {
    log.info(`auth.${event}`, payload);
  }
}
