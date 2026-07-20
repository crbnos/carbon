import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { ImplementationHubEmail } from "@carbon/documents/email";
import { ERP_URL } from "@carbon/env";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import {
  enrollImplementation,
  getImplementationHub
} from "@carbon/onboarding/server";
import { render } from "@react-email/components";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { path } from "~/utils/path";

const logger = getLogger("erp", "get-started");

// Self-serve: enroll the CURRENT company into the Implementation Hub. Anyone
// who can update company settings can enroll their own company — Carbon staff
// is not required. This is the only enrollment path today; the home page
// (x+/_index.tsx) surfaces it to unenrolled companies.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const serviceRole = getCarbonServiceRole();

  // Already enrolled (double submit, stale tab) — just go to the hub.
  const existing = await getImplementationHub(serviceRole, companyId);
  if (existing.data) {
    throw redirect(path.to.getStarted);
  }

  const result = await enrollImplementation(serviceRole, {
    companyId,
    userId,
    tier: "self_serve"
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to enroll company"))
    );
  }

  // Notify active Admins that the Implementation Hub is ready. Fire-and-forget:
  // enrollment must never fail because of an email error, so the whole block is
  // wrapped in try/catch and each send is isolated per recipient.
  try {
    const adminTypes = await serviceRole
      .from("employeeType")
      .select("id")
      .eq("companyId", companyId)
      .eq("systemType", "Admin");

    if (adminTypes.error) {
      throw adminTypes.error;
    }

    const adminTypeIds = (adminTypes.data ?? []).map((t) => t.id);
    if (adminTypeIds.length === 0) {
      logger.info(
        "No Admin employee type found for company; skipping enrollment notification"
      );
    } else {
      const admins = await serviceRole
        .from("employees")
        .select("id, email, name")
        .eq("companyId", companyId)
        .eq("active", true)
        .in("employeeTypeId", adminTypeIds);

      if (admins.error) {
        throw admins.error;
      }

      const hubUrl = `${ERP_URL}${path.to.getStarted}`;

      for (const admin of admins.data ?? []) {
        if (!admin.email) {
          continue;
        }
        try {
          const emailTemplate = ImplementationHubEmail({
            recipientName: admin.name ?? undefined,
            hubUrl
          });
          const html = await render(emailTemplate);
          const text = await render(emailTemplate, { plainText: true });
          await trigger("send-email", {
            to: [admin.email],
            subject: "Your Implementation Hub is ready",
            html,
            text,
            companyId
          });
        } catch (emailErr) {
          logger.error("Failed to send Implementation Hub email to admin", {
            adminId: admin.id ?? "unknown",
            error: emailErr
          });
        }
      }
    }
  } catch (notifyErr) {
    logger.error("Failed to notify admins of Implementation Hub enrollment", {
      error: notifyErr
    });
  }

  throw redirect(path.to.getStarted);
}
