import { assertIsPost, CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireAuthSession } from "@carbon/auth/session.server";
import { insertAuditLogEntries } from "@carbon/database/audit";
import type { CreateAuditLogEntry } from "@carbon/database/audit.types";
import { resolveIntegrationSecrets, SECRET_KEYS } from "@carbon/ee";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

const logger = getLogger("erp", "integration-reveal");

/**
 * Read a dot-path (`a.b.c`) from a nested object. Local copy of the helper in
 * `@carbon/ee/integrations/secrets.ts` — that module owns the secret dot-paths,
 * but its `getPath` is not re-exported from the `@carbon/ee` barrel, so we keep a
 * tiny reader here rather than reach into a deep import.
 */
function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Reveal a SINGLE integration secret on demand (NIST 800-171 3.13.16 / AC-3).
 *
 * Action-only route consumed by the Settings → Integrations "Reveal" button. It
 * is gated by `settings_update`, resolves the secret with a service-role client
 * (the vault RPCs are unreachable from a user client), and writes one audit
 * entry per reveal. Only the requested key's value is returned — never the whole
 * secret bag.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const { id: integrationId } = params;
  if (!integrationId) {
    return { error: "Integration not found" };
  }

  // MFA step-up. In a controlled (ITAR) environment the org already forces MFA
  // enrollment via the shell gate, and `requireAuthSession` bounces any session
  // whose user has a verified factor but is not yet `mfaVerified` to `/mfa`. We
  // additionally fail closed on this sensitive reveal if the session is not
  // MFA-verified. A dedicated per-reveal re-challenge (re-prompt for a TOTP code
  // at the moment of reveal) is a follow-up — see Task 7 of the plan.
  if (CONTROLLED_ENVIRONMENT) {
    const authSession = await requireAuthSession(request);
    if (!authSession.mfaVerified) {
      return {
        error: "Multi-factor verification is required to reveal secrets"
      };
    }
  }

  const formData = await request.formData();
  const key = formData.get("key");
  if (typeof key !== "string" || key.length === 0) {
    return { error: "Missing secret key" };
  }

  // Only declared secret keys may be revealed — never an arbitrary metadata
  // dot-path. This bounds the endpoint to the same key set the vault holds.
  const allowedKeys = SECRET_KEYS[integrationId] ?? [];
  if (!allowedKeys.includes(key)) {
    return { error: "Unknown secret key" };
  }

  const serviceClient = getCarbonServiceRole();

  try {
    // Read the row's non-secret config + vault pointer (RLS-gated user read),
    // then resolve the secret bag with the service-role client.
    const { data: row, error: rowError } = await serviceClient
      .from("companyIntegration")
      .select("metadata, secretRef")
      .eq("companyId", companyId)
      .eq("id", integrationId)
      .maybeSingle();

    if (rowError || !row) {
      return { error: "Integration not installed" };
    }

    const merged = await resolveIntegrationSecrets(
      serviceClient,
      companyId,
      integrationId,
      row.metadata,
      row.secretRef
    );

    const value = getPath(merged, key);
    if (value === undefined || value === null) {
      return { error: "Secret not set" };
    }

    // Audit the reveal. The operation enum is constrained to
    // INSERT/UPDATE/DELETE at the DB, so a secret access is recorded as the
    // INSERT of a new access event; the diff names only the KEY that was
    // revealed, never its value. `companyIntegration` is not a configured audit
    // entity, so the entityType is cast.
    const auditEntry: CreateAuditLogEntry = {
      tableName: "companyIntegration",
      entityType: "companyIntegration" as CreateAuditLogEntry["entityType"],
      entityId: integrationId,
      recordId: integrationId,
      operation: "INSERT",
      actorId: userId,
      diff: { revealedSecret: { new: key } },
      metadata: {
        origin: "web",
        userAgent: request.headers.get("user-agent") ?? undefined,
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined
      },
      createdAt: datetime.timestamp()
    };

    try {
      await insertAuditLogEntries(serviceClient, companyId, [auditEntry]);
    } catch (auditError) {
      // The audit table only exists once a company has enabled audit logging —
      // don't fail the reveal if the write fails, but do log it server-side.
      logger.error("Failed to write integration-reveal audit entry", {
        integrationId,
        error: auditError
      });
    }

    return { value: String(value) };
  } catch (err) {
    logger.error("Failed to reveal integration secret", {
      integrationId,
      error: err
    });
    return { error: "Failed to reveal secret" };
  }
}
