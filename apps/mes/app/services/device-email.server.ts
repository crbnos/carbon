import { describeNewDeviceLogin } from "@carbon/auth/user-login.server";
import type { Database } from "@carbon/database";
import { NewDeviceEmail } from "@carbon/documents/email";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { render } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ERP_URL } from "~/utils/path";

const logger = getLogger("mes", "device-email");

const SECURITY_URL = `${ERP_URL}/x/account/security`;

export async function sendNewDeviceEmail(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  request: Request
) {
  try {
    const user = await serviceRole
      .from("user")
      .select("email, fullName")
      .eq("id", userId)
      .eq("active", true)
      .single();

    if (user.error) throw user.error;
    if (!user.data.email) return;

    const email = NewDeviceEmail({
      recipientName: user.data.fullName ?? undefined,
      ...describeNewDeviceLogin(request),
      securityUrl: SECURITY_URL
    });

    await trigger("send-email", {
      to: [user.data.email],
      subject: "We've noticed a new login to your Carbon account",
      html: await render(email),
      text: await render(email, { plainText: true }),
      companyId
    });
  } catch (err) {
    logger.error("Failed to send new device email", {
      companyId,
      userId,
      error: err
    });
  }
}
