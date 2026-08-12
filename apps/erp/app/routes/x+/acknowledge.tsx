import { ITAR_RIDER_SHA256, ITAR_RIDER_VERSION } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { insertAuditLogEntries } from "@carbon/database/audit";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  itarEntityCertificationValidator,
  itarUserCertificationValidator,
  userFlagValidator
} from "~/modules/users";

const logger = getLogger("erp", "acknowledge");

/** Best-effort request metadata for the compliance record. */
function getRequestMeta(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress =
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = request.headers.get("user-agent") ?? null;
  return { ipAddress, userAgent };
}

/**
 * Records an ITAR certification (entity or user) with a 365-day expiry, plus a
 * best-effort audit-log entry carrying the IP/user-agent. Writes via the
 * service-role client because a self-attesting user does not hold settings_create.
 */
async function recordCertification({
  companyId,
  userId,
  type,
  fullLegalName,
  title,
  complianceContact,
  ipAddress,
  userAgent
}: {
  companyId: string;
  userId: string;
  type: "entity" | "user";
  fullLegalName: string;
  title?: string;
  complianceContact?: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const serviceRole = getCarbonServiceRole();
  const certifiedAt = datetime.timestamp();
  const expiresAt = parseAbsolute(certifiedAt, "UTC")
    .add({ days: 365 })
    .toAbsoluteString();

  const inserted = await serviceRole
    .from("itarCertification")
    .insert({
      companyId,
      userId,
      type,
      docVersion: ITAR_RIDER_VERSION,
      docHash: ITAR_RIDER_SHA256,
      fullLegalName,
      title: title ?? null,
      complianceContact: complianceContact ?? null,
      certifiedAt,
      ipAddress,
      userAgent,
      expiresAt,
      createdBy: userId
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    return { error: inserted.error };
  }

  // Best-effort — a company without audit logging enabled has no auditLog table;
  // the certification row itself is the authoritative compliance record.
  try {
    await insertAuditLogEntries(serviceRole, companyId, [
      {
        tableName: "itarCertification",
        entityType: "itarCertification",
        entityId: inserted.data.id,
        recordId: inserted.data.id,
        operation: "INSERT",
        actorId: userId,
        metadata: {
          ipAddress: ipAddress ?? undefined,
          userAgent: userAgent ?? undefined
        },
        createdAt: certifiedAt
      }
    ]);
  } catch (err) {
    logger.warn(`[acknowledge] audit write skipped for ${type} cert`, {
      error: err
    });
  }

  return { error: null };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const redirectTo = formData.get("redirectTo") as string | null;

  if (intent === "itar-entity") {
    // Only a representative who can bind the company may accept the Rider. The
    // UI gates Screen 1 on this same permission; enforce it here too, since this
    // writes via the service-role client (RLS bypassed) and unblocks the whole
    // company's controlled-environment gate.
    await requirePermissions(request, { update: "users" });

    const parsed = itarEntityCertificationValidator.safeParse({
      authorityToBind: formData.get("authorityToBind") === "on",
      acceptRider: formData.get("acceptRider") === "on",
      fullLegalName: formData.get("fullLegalName"),
      title: formData.get("title"),
      complianceContact: formData.get("complianceContact")
    });

    if (!parsed.success) {
      return { success: false, message: parsed.error.issues[0].message };
    }

    const { ipAddress, userAgent } = getRequestMeta(request);
    const { error } = await recordCertification({
      companyId,
      userId,
      type: "entity",
      fullLegalName: parsed.data.fullLegalName,
      title: parsed.data.title,
      complianceContact: parsed.data.complianceContact,
      ipAddress,
      userAgent
    });

    if (error) {
      logger.error(`[acknowledge] Failed to record entity cert:`, error);
      return { success: false, message: "Failed to record certification" };
    }

    return { success: true, message: "Rider accepted" };
  }

  if (intent === "itar-user") {
    const parsed = itarUserCertificationValidator.safeParse({
      certifyUsPerson: formData.get("certifyUsPerson") === "on",
      agreeNotify: formData.get("agreeNotify") === "on",
      understandPenalty: formData.get("understandPenalty") === "on",
      fullLegalName: formData.get("fullLegalName")
    });

    if (!parsed.success) {
      return { success: false, message: parsed.error.issues[0].message };
    }

    const { ipAddress, userAgent } = getRequestMeta(request);
    const { error } = await recordCertification({
      companyId,
      userId,
      type: "user",
      fullLegalName: parsed.data.fullLegalName,
      ipAddress,
      userAgent
    });

    if (error) {
      logger.error(`[acknowledge] Failed to record user cert:`, error);
      return { success: false, message: "Failed to record certification" };
    }

    return { success: true, message: "Certification recorded" };
  }

  // Generic flag handling — covers training dismissals and any future flags
  if (intent === "flag") {
    const parsed = userFlagValidator.safeParse({
      flag: formData.get("flag"),
      value: formData.get("value") === "true"
    });

    if (!parsed.success) {
      return { success: false, message: parsed.error.issues[0].message };
    }

    const { flag, value } = parsed.data;

    const { data: user, error: readError } = await client
      .from("user")
      .select("flags")
      .eq("id", userId)
      .single();

    if (readError) {
      logger.error(
        `[acknowledge] Failed to read flags for user ${userId}:`,
        readError
      );
      return { success: false, message: "Failed to read user flags" };
    }

    const currentFlags = (user?.flags as Record<string, boolean> | null) ?? {};
    const updatedFlags = { ...currentFlags, [flag]: value };

    const updateResult = await client
      .from("user")
      .update({ flags: updatedFlags })
      .eq("id", userId);

    if (updateResult.error) {
      logger.error(
        `[acknowledge] Failed to write flag "${flag}" for user ${userId}:`,
        updateResult.error
      );
      return { success: false, message: "Failed to update flag" };
    }

    if (redirectTo) {
      throw redirect(redirectTo);
    }

    return { success: true, message: "Flag updated" };
  }
}
