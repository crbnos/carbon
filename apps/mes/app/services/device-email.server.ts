import type { Database } from "@carbon/database";
import { NewDeviceEmail } from "@carbon/documents/email";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { render } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ERP_URL } from "~/utils/path";

const logger = getLogger("mes", "device-email");

// Account security lives in the ERP — MES has no account section of its own,
// which is why `path.to.accountSettings` is also an absolute ERP URL.
const SECURITY_URL = `${ERP_URL}/x/account/security`;

/**
 * MES twin of the ERP's `sendNewDeviceEmail`. A sign-in from an unrecognised
 * device is the one out-of-band signal a user gets that someone else reached
 * their account, and MES is the app most likely to be signed into from shared
 * shop-floor hardware — so it cannot be the door with no alarm on it.
 *
 * Duplicated rather than shared because `@carbon/jobs` (which owns `trigger`)
 * already depends on `@carbon/auth`, so the sender cannot move down into a
 * package without creating a cycle.
 *
 * Never throws: an alert that fails to send must not fail the sign-in.
 */
export async function sendNewDeviceEmail(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  deviceLabel: string
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
      deviceLabel,
      // UTC instant via the sanctioned helper — never a raw JS Date.
      signedInAt: datetime.timestamp(),
      securityUrl: SECURITY_URL
    });

    await trigger("send-email", {
      to: [user.data.email],
      subject: "A new device signed in to your Carbon account",
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
