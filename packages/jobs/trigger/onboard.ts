import { openai } from "@ai-sdk/openai";
import { getCarbonServiceRole, RESEND_DOMAIN } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { GetStartedEmail, WelcomeEmail } from "@carbon/documents/email";
import { resend } from "@carbon/lib/resend.server";
import { render } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { task, wait } from "@trigger.dev/sdk/v3";
import { generateObject } from "ai";
import z from "zod";

export const onboardTask = task({
  id: "onboard",
  run: async (payload: {
    type: "lead" | "customer";
    companyId: string;
    userId: string;
    plan?: string;
  }) => {
    const { type, companyId, userId, plan } = payload;

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

    switch (type) {
      case "lead":
        console.log(
          "Processing lead case for user:",
          userId,
          "company:",
          companyId
        );

        try {
          await resend.contacts.create({
            email: user.data.email,
            firstName: user.data.firstName,
            lastName: user.data.lastName,
            unsubscribed: false,
            audienceId: process.env.RESEND_AUDIENCE_ID!,
          });
          console.log(
            "Successfully created resend contact for:",
            user.data.email
          );
        } catch (error) {
          console.error("Error creating resend contact", error);
        }

        let type: "Warm" | "Cold" = "Warm";
        try {
          const { object } = await generateObject<Record<string, string>>({
            // @ts-ignore
            model: openai("gpt-4o"),
            schema: z.object({
              type: z.enum(["Warm", "Cold"]).describe("The type of lead"),
            }),
            prompt: `
              The following is a description of a lead for an ERP system. 
              Determine the quality of the lead based on the description.
              If the company seems like a real business, return "Warm".
              If it seems like someone is trying to keep their information private by providing a fake company name, return "Cold". 

              Description:
              Company: ${company.data.name}
              City: ${company.data.city}
              State: ${company.data.stateProvince}
              Address: ${company.data.addressLine1} ${company.data.addressLine2}
              Country: ${company.data.countryCode}
              Website: ${company.data.website}
              Phone: ${company.data.phone}
            `,
            temperature: 0.2,
          });
          type = object.type as "Warm" | "Cold";
          console.log("Generated type:", type);
        } catch (error) {
          console.error("Error generating type", error);
        }

        console.log("Attempting to send Slack message to #leads channel");
        try {
          const { getSlackClient } = await import("@carbon/lib/slack.server");
          const slackClient = getSlackClient();

          const slackResult = await slackClient.sendMessage({
            channel: "#leads",
            text: "New lead 🎉",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text:
                    `*New Signup* ${type === "Warm" ? "🥁" : "❄️"}\n\n` +
                    `*Contact Information*\n` +
                    `• Name: ${user.data?.firstName} ${user.data?.lastName}\n` +
                    `• Email: ${user.data?.email}\n` +
                    `• Location: ${company.data.city}, ${company.data.stateProvince}\n\n` +
                    `• Company: ${company.data.name}\n\n` +
                    `• Type: ${type}\n\n`,
                },
              },
            ],
          });
          console.log("Successfully sent Slack message:", slackResult);
        } catch (error) {
          console.error("Error sending Slack message:", error);
        }

        if (process.env.TWENTY_API_KEY) {
          try {
            const twentyPerson = await fetch(
              "https://api.twenty.com/rest/people",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.TWENTY_API_KEY}`,
                },
                body: JSON.stringify({
                  name: {
                    firstName: user.data.firstName,
                    lastName: user.data.lastName,
                  },
                  emails: {
                    primaryEmail: user.data.email,
                  },
                  customerStatus: ["PROSPECTIVE_CUSTOMER"],
                  location: `${company.data.city}, ${company.data.stateProvince}`,
                }),
              }
            );

            if (!twentyPerson.ok) {
              const errorText = await twentyPerson.text();
              console.error("Twenty API error response:", errorText);
              throw new Error(
                `Twenty CRM API error: ${twentyPerson.status} ${twentyPerson.statusText}`
              );
            }

            const twentyData = (await twentyPerson.json()) as {
              data: { createPerson: { id: string } };
            };
            const twentyPersonId = twentyData.data?.createPerson?.id;

            if (twentyPersonId) {
              const updateResult = await client
                .from("user")
                .update({
                  externalId: {
                    twenty: twentyPersonId,
                  },
                })
                .eq("id", userId);

              console.log("User update result:", updateResult);
              if (updateResult.error) {
                console.error(
                  "Error updating user external ID:",
                  updateResult.error
                );
              } else {
                console.log("Successfully updated user external ID");
              }

              if (type === "Warm") {
                const twentyCompany = await fetch(
                  "https://api.twenty.com/rest/companies",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${process.env.TWENTY_API_KEY}`,
                    },
                    body: JSON.stringify({
                      name: company.data.name,
                      domainName: {
                        primaryLinkLabel: removeProtocolFromWebsite(
                          company.data.website
                        ),
                        primaryLinkUrl: ensureProtocolFromWebsite(
                          company.data.website
                        ),
                        additionalLinks: [],
                      },
                    }),
                  }
                );

                if (!twentyCompany.ok) {
                  const errorText = await twentyCompany.text();
                  console.error("Twenty API error response:", errorText);
                  throw new Error(
                    `Twenty CRM API error: ${twentyCompany.status} ${twentyCompany.statusText}`
                  );
                }

                const twentyCompanyData = (await twentyCompany.json()) as {
                  data: { createCompany: { id: string } };
                };
                const twentyCompanyId =
                  twentyCompanyData.data?.createCompany?.id;

                if (twentyCompanyId) {
                  const twentyOpportunity = await fetch(
                    "https://api.twenty.com/rest/opportunities",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${process.env.TWENTY_API_KEY}`,
                      },
                      body: JSON.stringify({
                        name: `${company.data.name} Opportunity`,
                        stage: ["NEW"],
                        companyId: twentyCompanyId,
                        pointOfContactId: twentyPersonId,
                      }),
                    }
                  );

                  if (!twentyOpportunity.ok) {
                    const errorText = await twentyOpportunity.text();
                    console.error("Twenty API error response:", errorText);
                    throw new Error(
                      `Twenty CRM API error: ${twentyOpportunity.status} ${twentyOpportunity.statusText}`
                    );
                  }

                  const twentyOpportunityData =
                    (await twentyOpportunity.json()) as {
                      data: { createOpportunity: { id: string } };
                    };
                  const twentyOpportunityId =
                    twentyOpportunityData.data?.createOpportunity?.id;

                  if (twentyOpportunityId) {
                    const updateResult = await client
                      .from("company")
                      .update({
                        externalId: {
                          twenty: twentyOpportunityId,
                        },
                      })
                      .eq("id", companyId);

                    console.log("Company update result:", updateResult);
                    if (updateResult.error) {
                      console.error(
                        "Error updating company external ID:",
                        updateResult.error
                      );
                    } else {
                      console.log("Successfully updated company external ID");
                    }
                  }
                }
              }
            } else {
              console.error("No ID returned from Twenty CRM API");
            }
          } catch (error) {
            console.error("Error adding lead to CRM:", error);
          }
        } else {
          console.log("TWENTY_API_KEY not found, skipping CRM integration");
        }

        break;
      case "customer":
        // @ts-ignore
        const twentyId = user.data?.externalId?.twenty as string | undefined;

        try {
          const { getSlackClient } = await import("@carbon/lib/slack.server");
          const slackClient = getSlackClient();

          slackClient.sendMessage({
            channel: "#sales",
            text: "New Customer 🔔",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text:
                    `*New Signup* 🔔\n\n` +
                    `*Contact Information*\n` +
                    `• Company: ${company.data?.name}\n\n` +
                    `• Email: ${user.data.email}\n\n` +
                    `• Plan: $${plan}\n\n`,
                },
              },
            ],
          });
        } catch (error) {
          console.error("Error sending Slack message:", error);
        }

        if (twentyId) {
          try {
            await fetch(`https://api.twenty.com/rest/people/${twentyId}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.TWENTY_API_KEY}`,
              },
              body: JSON.stringify({
                customerStatus: ["PILOT_FREE_TRIAL"],
              }),
            });
          } catch (error) {
            console.error("Error updating twenty customer status:", error);
          }
        }

        const from = `Brad from Carbon <${
          RESEND_DOMAIN === "carbon.ms"
            ? "brad@carbon.ms"
            : `no-reply@${RESEND_DOMAIN}`
        }>`;

        const sendOnboardingEmail = await shouldSendOnboardingEmailsToUser(
          client,
          userId
        );

        if (sendOnboardingEmail) {
          await resend.emails.send({
            from,
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
            from,
            to: user.data.email,
            subject: `Get the most out of Carbon`,
            html: await render(
              GetStartedEmail({
                firstName: user.data.firstName,
                academyUrl: "https://learn.carbon.ms",
              })
            ),
          });
        }

        await wait.for({ days: 30 });

        const planAfter30Days = await client
          .from("companyPlan")
          .select("*")
          .eq("id", companyId)
          .maybeSingle();

        let isPlanActiveAfter30Days =
          planAfter30Days?.data?.stripeSubscriptionStatus === "Active";

        if (isPlanActiveAfter30Days) {
          await fetch(`https://api.twenty.com/rest/people/${twentyId}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.TWENTY_API_KEY}`,
            },
            body: JSON.stringify({
              customerStatus: [
                isPlanActiveAfter30Days
                  ? "CHURNED_CANCELED"
                  : "EXISTING_CUSTOMER",
              ],
            }),
          });
        }

        break;
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

function removeProtocolFromWebsite(website: string) {
  if (!website) return undefined;
  return website.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

function ensureProtocolFromWebsite(website: string) {
  if (!website) return undefined;
  return website.startsWith("http") ? website : `https://${website}`;
}
