import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyHasFeature } from "../plan.server";

/**
 * Commercial gate for the EMAIL notification channel. The notification fan-out
 * (`@carbon/jobs` `notify`) calls this to decide whether to deliver email;
 * in-app and Slack channels are unaffected. This is a runtime DEGRADE path — it
 * returns a boolean rather than throwing, so a company without the feature
 * simply skips email rather than failing the whole notification.
 *
 * The point of it living here (not as an inline `companyHasFeature(...,
 * "EMAIL_NOTIFICATIONS")` in community `@carbon/jobs`) is that the feature key
 * and the gate decision sit on the COMMERCIAL side of the license boundary:
 * removing the lock requires editing `@carbon/ee`, not deleting an `if` in
 * open-licensed code. Generic transactional email (invites, password/MFA,
 * onboarding) goes through `@carbon/lib` `sendEmail` and is deliberately NOT
 * gated here.
 */
export async function emailNotificationsEnabled(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<boolean> {
  return companyHasFeature(client, companyId, {
    feature: "EMAIL_NOTIFICATIONS"
  });
}
