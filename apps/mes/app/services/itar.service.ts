// ITAR certification helpers for MES. Mirrors the ERP implementation
// (apps/erp/app/modules/users/users.service.ts + routes/x+/acknowledge.tsx) —
// keep the two in sync; the legal validators must not drift.
import { ITAR_RIDER_SHA256, ITAR_RIDER_VERSION } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { insertAuditLogEntries } from "@carbon/database/audit";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const logger = getLogger("mes", "itar");

export const itarEntityCertificationValidator = z.object({
  authorityToBind: z.literal(true, {
    errorMap: () => ({ message: "You must confirm your authority to bind" })
  }),
  acceptRider: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Rider" })
  }),
  fullLegalName: z
    .string()
    .trim()
    .min(1, { message: "Full legal name is required" }),
  title: z.string().trim().min(1, { message: "Title is required" }),
  complianceContact: z
    .string()
    .trim()
    .min(1, { message: "Export compliance contact is required" })
});

export const itarUserCertificationValidator = z.object({
  certifyUsPerson: z.literal(true, {
    errorMap: () => ({ message: "You must certify that you are a U.S. Person" })
  }),
  agreeNotify: z.literal(true, {
    errorMap: () => ({
      message: "You must agree to the notification requirement"
    })
  }),
  understandPenalty: z.literal(true, {
    errorMap: () => ({ message: "You must acknowledge the penalties" })
  }),
  fullLegalName: z
    .string()
    .trim()
    .min(1, { message: "Full legal name is required" })
});

export async function getItarCertificationStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
): Promise<{ entityCertified: boolean; userCertified: boolean }> {
  const now = datetime.timestamp();

  const [entity, user] = await Promise.all([
    client
      .from("itarCertification")
      .select("id")
      .eq("companyId", companyId)
      .eq("type", "entity")
      .gt("expiresAt", now)
      .limit(1)
      .maybeSingle(),
    client
      .from("itarCertification")
      .select("id")
      .eq("companyId", companyId)
      .eq("type", "user")
      .eq("userId", userId)
      .gt("expiresAt", now)
      .limit(1)
      .maybeSingle()
  ]);

  return {
    entityCertified: Boolean(entity.data),
    userCertified: Boolean(user.data)
  };
}

export function getRequestMeta(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress =
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = request.headers.get("user-agent") ?? null;
  return { ipAddress, userAgent };
}

export async function recordItarCertification({
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
    logger.warn(`[itar] audit write skipped for ${type} cert`, { error: err });
  }

  return { error: null };
}
