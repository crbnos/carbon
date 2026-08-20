import type { Database } from "@carbon/database";
import { MfaEnabledEmail, MfaRequiredEmail } from "@carbon/documents/email";
import { batchTrigger, trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { render } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ERP_URL, path } from "~/utils/path";

const logger = getLogger("erp", "mfa-email");

// Recipients per Inngest send. The announcement runs inside the request that
// flipped the setting, so it can't be one round trip per employee; batching
// keeps a 300-person company to a dozen sends while capping each request body
// (a rendered email is ~20 KB) and limiting what a single failed send costs.
const EMAIL_BATCH_SIZE = 25;

const securityUrl = () => `${ERP_URL}${path.to.accountSecurity}`;

/**
 * Announce a newly-turned-on two-factor requirement to every active employee of
 * the company.
 *
 * Deliberately NOT routed through `trigger("notify", ...)`: this is a security
 * announcement, so it must not be silenced by a per-user notification
 * preference or gated on the company's EMAIL_NOTIFICATIONS plan feature.
 *
 * Never throws — turning the setting on must not fail because email did.
 * Callers pass a service-role client: the announcement covers every employee,
 * including ones the acting admin's RLS scope wouldn't return.
 */
export async function sendMfaRequiredEmails(
  serviceRole: SupabaseClient<Database>,
  companyId: string
) {
  try {
    const [company, employees] = await Promise.all([
      serviceRole.from("company").select("name").eq("id", companyId).single(),
      serviceRole
        .from("employees")
        .select("id, email, name")
        .eq("companyId", companyId)
        .eq("active", true)
    ]);

    if (company.error) throw company.error;
    if (employees.error) throw employees.error;

    const setupUrl = securityUrl();
    const companyName = company.data.name;
    const subject = `Two-factor authentication is now required for ${companyName}`;
    const recipients = (employees.data ?? []).filter(
      (employee): employee is typeof employee & { email: string } =>
        !!employee.email
    );

    for (let i = 0; i < recipients.length; i += EMAIL_BATCH_SIZE) {
      const batch = recipients.slice(i, i + EMAIL_BATCH_SIZE);
      try {
        // The greeting is per-recipient, so each email is rendered separately.
        const items = await Promise.all(
          batch.map(async (employee) => {
            const email = MfaRequiredEmail({
              recipientName: employee.name ?? undefined,
              companyName,
              setupUrl
            });
            return {
              payload: {
                to: [employee.email],
                subject,
                html: await render(email),
                text: await render(email, { plainText: true }),
                companyId
              }
            };
          })
        );
        await batchTrigger("send-email", items);
      } catch (err) {
        logger.error(
          "Failed to send a batch of two-factor requirement emails",
          {
            companyId,
            employeeIds: batch.map((employee) => employee.id ?? "unknown"),
            error: err
          }
        );
      }
    }
  } catch (err) {
    logger.error("Failed to announce two-factor requirement", {
      companyId,
      error: err
    });
  }
}

/**
 * Confirm to a user that an authenticator app was added to their own account —
 * the receipt that lets them notice an enrollment they didn't perform.
 *
 * Same reasoning as above: account-security mail, so no preference or plan
 * gating, and it never throws (the factor is already verified by the time this
 * runs — failing the request would leave the user with MFA on and an error).
 */
export async function sendMfaEnabledEmail(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  try {
    const user = await serviceRole
      .from("user")
      .select("email, fullName")
      .eq("id", userId)
      .single();

    if (user.error) throw user.error;
    if (!user.data.email) return;

    const email = MfaEnabledEmail({
      recipientName: user.data.fullName ?? undefined,
      securityUrl: securityUrl()
    });

    await trigger("send-email", {
      to: [user.data.email],
      subject: "Two-factor authentication is on for your Carbon account",
      html: await render(email),
      text: await render(email, { plainText: true }),
      companyId
    });
  } catch (err) {
    logger.error("Failed to send two-factor enabled email", {
      companyId,
      userId,
      error: err
    });
  }
}
