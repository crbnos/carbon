import { openai } from "@ai-sdk/openai";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { GetStartedEmail, WelcomeEmail } from "@carbon/documents/email";
import { RESEND_DOMAIN } from "@carbon/env";
import { resend, sendEmail } from "@carbon/lib/resend.server";
import { getSlackClient } from "@carbon/lib/slack.server";
import { getTwentyClient } from "@carbon/lib/twenty.server";
import { render } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { z } from "zod/v3";
import { inngest } from "../../client";

export const onboardFunction = inngest.createFunction(
  { id: "onboard", retries: 3 },
  { event: "carbon/onboard" },
  async ({ event, step, logger }) => {
    const { type, companyId, userId, plan } = event.data;

    const carbon = getCarbonServiceRole();
    const twenty = getTwentyClient();
    const slack = getSlackClient();

    const { company, user } = await step.run(
      "load-company-and-user",
      async () => {
        const [company, user] = await Promise.all([
          carbon.from("company").select("*").eq("id", companyId).single(),
          carbon.from("user").select("*").eq("id", userId).single()
        ]);

        if (company.error) {
          logger.error("Could not find company", company.error);
          throw new Error(company.error.message);
        }

        if (user.error) {
          logger.error("Could not find user", user.error);
          throw new Error(user.error.message);
        }

        return { company: company.data, user: user.data };
      }
    );

    switch (type) {
      case "lead":
        await step.run("create-resend-contact", async () => {
          logger.info(
            "Processing lead case for user:",
            userId,
            "company:",
            companyId
          );

          try {
            await resend.contacts.create({
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              unsubscribed: false,
              audienceId: process.env.RESEND_AUDIENCE_ID!
            });
            logger.info("Successfully created resend contact for:", user.email);
          } catch (error) {
            logger.error("Error creating resend contact", error);
          }
        });

        const leadType = await step.run("classify-lead", async () => {
          let type: "Warm" | "Cold" = "Warm";
          try {
            const { object } = await generateObject({
              model: openai("gpt-4o"),
              schema: z.object({
                type: z.enum(["Warm", "Cold"]).describe("The type of lead")
              }),
              prompt: `
                The following is a description of a lead for an ERP system.
                Determine the quality of the lead based on the description.
                If the company seems like a real business, return "Warm".
                If it seems like someone is trying to keep their information private by providing a fake company name, return "Cold".

                Description:
                Company: ${company.name}
                City: ${company.city}
                State: ${company.stateProvince}
                Address: ${company.addressLine1} ${company.addressLine2}
                Country: ${company.countryCode}
                Website: ${company.website}
                Phone: ${company.phone}
              `,
              temperature: 0.2
            });
            type = (object as any).type as "Warm" | "Cold";
            logger.info("Generated type:", type);
          } catch (error) {
            logger.error("Error generating type", error);
          }
          return type;
        });

        await step.run("send-slack-lead-notification", async () => {
          logger.info("Attempting to send Slack message to #leads channel");
          try {
            const slackResult = await slack.sendMessage({
              channel: "#leads",
              text: "New lead 🎉",
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text:
                      `*New Signup* ${leadType === "Warm" ? "🥁" : "❄️"}\n\n` +
                      `*Contact Information*\n` +
                      `• Name: ${user?.firstName} ${user?.lastName}\n` +
                      `• Email: ${user?.email}\n` +
                      `• Location: ${company.city}, ${company.stateProvince}\n\n` +
                      `• Company: ${company.name}\n\n` +
                      `• Type: ${leadType}\n\n`
                  }
                }
              ]
            });
            logger.info("Successfully sent Slack message:", slackResult);
          } catch (error) {
            logger.error("Error sending Slack message:", error);
          }
        });

        await step.run("add-lead-to-crm", async () => {
          if (process.env.TWENTY_API_KEY) {
            try {
              const twentyPersonId = await twenty.createPerson({
                name: {
                  firstName: user.firstName,
                  lastName: user.lastName
                },
                emails: {
                  primaryEmail: user.email
                },
                customerStatus: ["PROSPECTIVE_CUSTOMER"],
                location: `${company.city}, ${company.stateProvince}`
              });

              const updateResult = await carbon
                .from("user")
                .update({
                  externalId: {
                    twenty: twentyPersonId
                  }
                } as any)
                .eq("id", userId);

              logger.info("User update result:", updateResult);
              if (updateResult.error) {
                logger.error(
                  "Error updating user external ID:",
                  updateResult.error
                );
              } else {
                logger.info("Successfully updated user external ID");
              }

              if (leadType === "Warm") {
                const twentyCompanyId = await twenty.createCompany({
                  name: company.name,
                  domainName: {
                    primaryLinkLabel: removeProtocolFromWebsite(
                      company.website ?? ""
                    ),
                    primaryLinkUrl: ensureProtocolFromWebsite(
                      company.website ?? ""
                    ),
                    additionalLinks: []
                  }
                });

                const twentyOpportunityId = await twenty.createOpportunity({
                  name: `${company.name} Opportunity`,
                  stage: ["NEW"],
                  companyId: twentyCompanyId,
                  pointOfContactId: twentyPersonId
                });

                const updateResult = await carbon
                  .from("company")
                  .update({
                    externalId: {
                      twenty: twentyOpportunityId
                    }
                  } as any)
                  .eq("id", companyId);

                logger.info("Company update result:", updateResult);
                if (updateResult.error) {
                  logger.error(
                    "Error updating company external ID:",
                    updateResult.error
                  );
                } else {
                  logger.info("Successfully updated company external ID");
                }
              }
            } catch (error) {
              logger.error("Error adding lead to CRM:", error);
            }
          } else {
            logger.info("TWENTY_API_KEY not found, skipping CRM integration");
          }
        });

        break;

      case "customer":
        // @ts-ignore
        const twentyId = user?.externalId?.twenty as string | undefined;

        await step.run("send-slack-customer-notification", async () => {
          try {
            slack.sendMessage({
              channel: "#sales",
              text: "New Customer",
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text:
                      `*New Signup*\n\n` +
                      `*Contact Information*\n` +
                      `• Name: ${user?.firstName} ${user?.lastName}\n` +
                      `• Email: ${user.email}\n` +
                      `• Company: ${company?.name}\n\n` +
                      `• Plan: $${plan}\n\n`
                  }
                }
              ]
            });
          } catch (error) {
            logger.error("Error sending Slack message:", error);
          }
        });

        await step.run("update-twenty-customer-status", async () => {
          if (twentyId) {
            try {
              await twenty.updatePerson(twentyId, {
                customerStatus: ["PILOT_FREE_TRIAL"]
              });
            } catch (error) {
              logger.error("Error updating twenty customer status:", error);
            }
          }
        });

        const sendOnboardingEmail = await step.run(
          "check-onboarding-email-eligibility",
          async () => {
            return shouldSendOnboardingEmailsToUser(carbon, userId);
          }
        );

        await step.sleep("wait-5m", "5m");

        if (sendOnboardingEmail) {
          const from = `Chase from Carbon <${
            RESEND_DOMAIN === "carbon.ms"
              ? "chase@carbon.ms"
              : `no-reply@${RESEND_DOMAIN}`
          }>`;
          await step.run("send-welcome-email", async () => {
            await sendEmail({
              from,
              to: user.email,
              subject: `Carbon`,
              html: await render(WelcomeEmail())
            });
          });
        }

        await step.sleep("wait-3d", "3d");

        if (sendOnboardingEmail) {
          const from = `Info from Carbon <${
            RESEND_DOMAIN === "carbon.ms"
              ? "info@carbon.ms"
              : `no-reply@${RESEND_DOMAIN}`
          }>`;
          await step.run("send-get-started-email", async () => {
            await sendEmail({
              from,
              to: user.email,
              subject: `Get the most out of Carbon`,
              html: await render(
                GetStartedEmail({
                  firstName: user.firstName,
                  academyUrl: "https://learn.carbon.ms"
                })
              )
            });
          });
        }

        await step.sleep("wait-30d", "30d");

        await step.run("check-plan-status-after-30d", async () => {
          const planAfter30Days = await carbon
            .from("companyPlan")
            .select("*")
            .eq("id", companyId)
            .maybeSingle();

          let isPlanActiveAfter30Days =
            planAfter30Days?.data?.stripeSubscriptionStatus === "Active";

          if (isPlanActiveAfter30Days && twentyId) {
            await twenty.updatePerson(twentyId, {
              customerStatus: [
                isPlanActiveAfter30Days
                  ? "CHURNED_CANCELED"
                  : "EXISTING_CUSTOMER"
              ]
            });
          }
        });

        break;
    }
  }
);

async function shouldSendOnboardingEmailsToUser(
  carbon: SupabaseClient<Database>,
  userId: string
) {
  const userToCompany = await carbon
    .from("userToCompany")
    .select("*")
    .eq("userId", userId);

  if (userToCompany.error) {
    return true;
  }

  return userToCompany.data.length <= 1;
}

function removeProtocolFromWebsite(website: string) {
  if (!website) return undefined;
  return website.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

function ensureProtocolFromWebsite(website: string) {
  if (!website) return undefined;
  return website.startsWith("http") ? website : `https://${website}`;
}
