import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { GetStartedEmail, WelcomeEmail } from "@carbon/documents/email";
import { resend } from "@carbon/lib/resend.server";
import { render } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { task, wait } from "@trigger.dev/sdk/v3";

export const onboardTask = task({
  id: "onboard",
  run: async (payload: { companyId: string; userId: string }) => {
    const { companyId, userId } = payload;

    const client = getCarbonServiceRole();

    const [company, user] = await Promise.all([
      client.from("company").select("*").eq("id", companyId).single(),
      client.from("user").select("*").eq("id", userId).single(),
    ]);

    if (company.error) {
      console.error("Could not find company", company.error);
      throw new Error(company.error.message);
    }

    if (user.error) {
      console.error("Could not find user", user.error);
      throw new Error(user.error.message);
    }

    await resend.contacts.create({
      email: user.data.email,
      firstName: user.data.firstName,
      lastName: user.data.lastName,
      unsubscribed: false,
      audienceId: process.env.RESEND_AUDIENCE_ID!,
    });

    const sendOnboardingEmail = await shouldSendOnboardingEmailsToUser(
      client,
      userId
    );

    if (sendOnboardingEmail) {
      await resend.emails.send({
        from: "Brad from Carbon <brad@carbon.ms>",
        to: user.data.email,
        subject: `Welcome to Carbon`,
        html: await render(
          WelcomeEmail({
            firstName: user.data.firstName,
          })
        ),
      });
    }

    await wait.for({ days: 3 });

    if (sendOnboardingEmail) {
      await resend.emails.send({
        from: "Brad from Carbon <brad@carbon.ms>",
        to: user.data.email,
        subject: `Get the most out of Carbon`,
        html: render(
          GetStartedEmail({
            firstName: user.data.firstName,
            academyUrl: "https://learn.carbon.ms",
          })
        ),
      });
    }
  },
});

async function shouldSendOnboardingEmailsToUser(
  client: SupabaseClient<Database>,
  userId: string
) {
  const userToCompany = await client
    .from("userToCompany")
    .select("*")
    .eq("userId", userId);

  if (userToCompany.error) {
    return true;
  }

  return userToCompany.data.length <= 1;
}
