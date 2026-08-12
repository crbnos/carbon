import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { requiresItarEntityCertification } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getRequestMeta,
  itarEntityCertificationValidator,
  itarUserCertificationValidator,
  recordItarCertification
} from "~/services/itar.service";

const logger = getLogger("mes", "acknowledge");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {}
  );

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const redirectTo = formData.get("redirectTo") as string | null;

  if (intent === "academy") {
    const { data: user, error: readError } = await client
      .from("user")
      .select("flags")
      .eq("id", userId)
      .single();

    if (readError) {
      return { success: false, message: "Failed to read user flags" };
    }

    const currentFlags = (user?.flags as Record<string, boolean> | null) ?? {};
    const updatedFlags = { ...currentFlags, academy: true };

    await client.from("user").update({ flags: updatedFlags }).eq("id", userId);

    if (redirectTo) {
      throw redirect(redirectTo);
    }

    return { success: true, message: "University acknowledged" };
  }

  if (intent === "itar-entity") {
    // Only a representative who can bind the company may accept the Rider. MES
    // never renders Screen 1 (that is an ERP admin action), but this endpoint is
    // still live and writes via the service-role client (RLS bypassed), so
    // enforce the same permission the ERP action does.
    await requirePermissions(request, { update: "users" });

    // Carbon staff hold users_update in every tenant they provisioned, so the
    // permission check alone would let us bind a customer to a document only
    // the customer can sign; an API key carries no signer identity at all
    // (empty email on that path). Mirrors the ERP action.
    if (!email || !requiresItarEntityCertification(email)) {
      return {
        success: false,
        message:
          "The Rider must be accepted by a representative of the company it binds."
      };
    }

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
    const { error } = await recordItarCertification({
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
    const { error } = await recordItarCertification({
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
}
