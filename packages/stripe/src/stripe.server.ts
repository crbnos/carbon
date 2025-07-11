import {
  CarbonEdition,
  getAppUrl,
  getCarbonServiceRole,
  STRIPE_BYPASS_COMPANY_IDS,
} from "@carbon/auth";
import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import { getSlackClient } from "@carbon/lib/slack.server";
import { Edition, Plan } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tasks } from "@trigger.dev/sdk/v3";
import { Stripe } from "stripe";
import { z } from "zod";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("process.env.STRIPE_SECRET_KEY not defined");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-06-30.basil",
  typescript: true,
});

const KvStripeCustomerSchema = z.object({
  subscriptionId: z.string(),
  status: z.union([
    z.literal("active"),
    z.literal("canceled"),
    z.literal("incomplete"),
    z.literal("incomplete_expired"),
    z.literal("past_due"),
    z.literal("paused"),
    z.literal("trialing"),
    z.literal("unpaid"),
  ]),
  planId: z.string().nullish(),
  priceId: z.string(),
  currentPeriodStart: z.number(),
  currentPeriodEnd: z.number(),
  cancelAtPeriodEnd: z.boolean(),
  paymentMethod: z
    .object({
      brand: z.string().nullable(),
      last4: z.string().nullable(),
    })
    .nullable(),
});

const allowedEventTypes = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.upcoming",
  "invoice.marked_uncollectible",
  "invoice.payment_succeeded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
] as const;
type AllowedEventType = (typeof allowedEventTypes)[number];

export async function createStripeCustomer({
  userId,
  companyId,
  email,
  name,
}: {
  userId: string;
  companyId: string;
  email: string;
  name?: string | null;
}) {
  try {
    const customer = await stripe.customers.create(
      {
        email,
        name: name ?? undefined,
        metadata: {
          userId,
          companyId,
        },
      },
      {
        idempotencyKey: `${companyId}-${userId}`,
      }
    );

    // Store the relation between companyId and stripeCustomerId in KV
    await redis.set(
      `stripe:company:${companyId}`,
      KvStripeUserSchema.parse(customer.id)
    );

    return customer;
  } catch (error) {
    console.error("Error creating Stripe customer:", error);
    throw error;
  }
}

function getPlanById(client: SupabaseClient<Database>, planId: string) {
  return client.from("plan").select("*").eq("id", planId).single();
}

function getPlanByPriceId(client: SupabaseClient<Database>, priceId: string) {
  return client.from("plan").select("*").eq("stripePriceId", priceId).single();
}

export async function getStripeCustomerByCompanyId(companyId: string) {
  if (CarbonEdition !== Edition.Cloud) {
    return null;
  }

  // Check if this company is in the bypass list
  if (STRIPE_BYPASS_COMPANY_IDS) {
    const bypassList = STRIPE_BYPASS_COMPANY_IDS.split(",").map((id: string) =>
      id.trim()
    );
    if (bypassList.includes(companyId)) {
      // Return a mock customer object that satisfies the expected interface
      return {
        subscriptionId: "bypass-subscription",
        status: "active" as const,
        priceId: "bypass-price",
        planId: Plan.Partner,
        currentPeriodStart: Math.floor(Date.now() / 1000),
        currentPeriodEnd: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year from now
        cancelAtPeriodEnd: false,
        paymentMethod: null,
      };
    }
  }

  const customerId = await getStripeCustomerId(companyId);
  if (!customerId) {
    return null;
  }
  const customer = await getStripeCustomer(customerId);
  if (!customer || customer.status === "canceled") {
    return null;
  }

  return customer;
}

export async function getStripeCustomer(customerId: string) {
  if (CarbonEdition !== Edition.Cloud) {
    return null;
  }

  const customer = await redis.get(`stripe:customer:${customerId}`);
  return KvStripeCustomerSchema.nullish().parse(customer);
}

const KvStripeUserSchema = z.string().nullish();

export async function getStripeCustomerId(companyId: string) {
  if (CarbonEdition !== Edition.Cloud) {
    return null;
  }

  return KvStripeUserSchema.parse(
    await redis.get(`stripe:company:${companyId}`)
  );
}

function getStripeWebhookEvent({
  body,
  signature,
}: {
  body: string;
  signature: string;
}) {
  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
    return { success: true as const, event: event, error: null };
  } catch (error) {
    return { success: false as const, error: error as Error, event: null };
  }
}

export async function getCheckoutUrl({
  planId,
  userId,
  companyId,
  email,
  name,
}: {
  planId: string;
  userId: string;
  companyId: string;
  email: string;
  name?: string | null;
}) {
  if (CarbonEdition !== Edition.Cloud) {
    return "";
  }

  const customerId = await getStripeCustomerId(companyId);
  let stripeCustomerId = customerId;

  if (!stripeCustomerId) {
    // Create a new customer if one doesn't exist
    const customer = await createStripeCustomer({
      userId,
      companyId,
      email,
      name,
    });
    stripeCustomerId = customer.id;
  }

  const serviceRole = getCarbonServiceRole();
  const plan = await getPlanById(serviceRole, planId);
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    line_items: [
      {
        price: plan.data.stripePriceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${getAppUrl()}/api/webhook/stripe`,
    cancel_url: `${getAppUrl()}/api/webhook/stripe`,
    payment_method_types: ["card", "us_bank_account", "cashapp"],
    subscription_data: {
      trial_period_days: plan.data.stripeTrialPeriodDays,
    },
    metadata: {
      userId,
      companyId,
    },
  });

  if (!checkoutSession.url) {
    throw new Error("Failed to create checkout session");
  }

  return checkoutSession.url;
}

export async function getBillingPortalRedirectUrl({
  companyId,
}: {
  companyId: string;
}) {
  if (CarbonEdition !== Edition.Cloud) {
    return getAppUrl();
  }

  const customerId = await getStripeCustomerId(companyId);
  if (!customerId) {
    throw new Error("Customer not found");
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getAppUrl()}/x/settings/company`,
  });

  if (!portalSession.url) {
    throw new Error("Failed to create portal session");
  }

  return portalSession.url;
}

async function upsertCompanyPlan(
  client: SupabaseClient<Database>,
  companyPlan: Database["public"]["Tables"]["companyPlan"]["Insert"]
) {
  return client.from("companyPlan").upsert(companyPlan);
}

function isAllowedEventType<TEvent extends Stripe.Event>(
  event: TEvent
): event is TEvent & { type: AllowedEventType } {
  return allowedEventTypes.includes(event.type as AllowedEventType);
}

export async function processStripeEvent({
  body,
  signature,
}: {
  body: string;
  signature: string;
}) {
  if (CarbonEdition !== Edition.Cloud) {
    return;
  }

  const {
    event,
    success: eventSuccess,
    error: eventError,
  } = getStripeWebhookEvent({ body, signature });

  if (!eventSuccess) {
    throw new Error(`Stripe webhook event error: ${eventError.message}`);
  }

  if (!isAllowedEventType(event)) {
    console.warn(
      `[STRIPE HOOK] Received untracked event: ${event.type}. Configure webhook event types in your Stripe dashboard.`
    );
    return;
  }

  const eventType = event.type;

  if (eventType === "checkout.session.completed") {
    const slackClient = getSlackClient();
    const data = event.data.object as Stripe.Checkout.Session;
    const { customer } = data;

    const companyId = data.metadata.companyId;
    const userId = data.metadata.userId;

    if (!companyId || !userId) {
      console.error(
        "Missing required metadata in checkout session:",
        data.metadata
      );
      throw new Error("Missing required metadata in checkout session");
    }

    if (typeof customer !== "string") {
      throw new Error("Stripe webhook handler failed");
    }

    try {
      await Promise.all([
        syncStripeDataToKV(customer, companyId),
        tasks.trigger("onboard", {
          companyId,
          userId,
        }),
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
                  `• Company: ${data.customer_details?.name}\n\n` +
                  `• Email: ${data.customer_details?.email}\n\n` +
                  `• Plan: $${data.line_items?.data[0]?.description}\n\n`,
              },
            },
          ],
        }),
      ]);
    } catch (error) {
      console.error("Error processing webhook:", error);
      throw new Error("Stripe webhook handler failed");
    }
  } else if (eventType === "customer.subscription.updated") {
    const data = event.data.object as Stripe.Subscription;
    const { customer } = data;

    if (typeof customer !== "string") {
      throw new Error("Stripe webhook handler failed");
    }

    try {
      await syncStripeDataToKV(customer);
    } catch (error) {
      console.error("Error processing webhook:", error);
      throw new Error("Stripe webhook handler failed");
    }
  } else if (eventType === "customer.subscription.deleted") {
    const data = event.data.object as Stripe.Subscription;
    const { customer } = data;

    if (typeof customer !== "string") {
      throw new Error("Stripe webhook handler failed");
    }

    try {
      const serviceRole = getCarbonServiceRole();
      const key = `stripe:customer:${customer}`;

      await Promise.all([
        redis.del(key),
        serviceRole
          .from("companyPlan")
          .delete()
          .eq("stripeCustomerId", customer),
      ]);
    } catch (error) {
      console.error("Error processing webhook:", error);
      throw new Error("Stripe webhook handler failed");
    }
  }
}

export async function syncStripeDataToKV(
  customerId: string,
  companyIdFromMetadata?: string
) {
  const key = `stripe:customer:${customerId}`;
  let companyId = companyIdFromMetadata;
  const serviceRole = getCarbonServiceRole();

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    limit: 1,
    status: "all",
    expand: ["data.default_payment_method"],
  });

  if (subscriptions.data.length === 0) {
    await redis.del(key);
    return null;
  }

  if (!companyId) {
    const companyPlan = await serviceRole
      .from("companyPlan")
      .select("*")
      .eq("stripeCustomerId", customerId)
      .single();

    companyId = companyPlan.data?.id;
  }

  const subscription = subscriptions.data[0];
  const plan = await getPlanByPriceId(
    serviceRole,
    subscription.items.data[0].price.id
  );

  if (!plan.data) {
    console.error("Failed to get plan by price id:", plan.error);
    throw new Error(
      `Failed to get plan for price_id: ${subscription.items.data[0].price.id}`
    );
  }

  const subDataResult = KvStripeCustomerSchema.safeParse({
    subscriptionId: subscription.id,
    status: subscription.status,
    planId: plan.data?.id ?? null,
    priceId: subscription.items.data[0].price.id,
    currentPeriodStart: subscription.items.data[0].current_period_start,
    currentPeriodEnd: subscription.items.data[0].current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    paymentMethod:
      subscription.default_payment_method &&
      typeof subscription.default_payment_method !== "string"
        ? {
            brand: subscription.default_payment_method.card?.brand ?? null,
            last4: subscription.default_payment_method.card?.last4 ?? null,
          }
        : null,
  });

  if (!subDataResult.success) {
    console.error("Failed to parse subscription data:", subDataResult.error);
    throw new Error("Failed to parse subscription data");
  }

  const subData = subDataResult.data;

  if (companyId) {
    const companyPlanData: Database["public"]["Tables"]["companyPlan"]["Insert"] =
      {
        id: companyId,
        planId: plan.data?.id ?? null,
        tasksLimit: plan.data.tasksLimit,
        aiTokensLimit: plan.data.aiTokensLimit,
        usersLimit: 10, // Default value as defined in the migration
        stripeSubscriptionStatus: (subData.cancelAtPeriodEnd
          ? "Canceled"
          : ["active", "trialing"].includes(subData.status)
          ? "Active"
          : "Inactive") as "Active" | "Inactive" | "Canceled",
        stripeCustomerId: customerId,
        stripeSubscriptionId: subData.subscriptionId,
        subscriptionStartDate: new Date(
          subData.currentPeriodStart * 1000
        ).toISOString(),
      };

    const [, companyPlan] = await Promise.all([
      redis.set(key, subData),
      upsertCompanyPlan(serviceRole, companyPlanData),
    ]);

    if (companyPlan.error) {
      console.error("Failed to upsert company plan:", companyPlan.error);
    }
  } else {
    console.error("no company id, skipping company plan upsert");
  }

  return subDataResult;
}

export async function updateActiveUsers({
  subscriptionId,
  activeUsers,
}: {
  subscriptionId: string;
  activeUsers: number;
}) {
  await stripe.subscriptionItems.update(subscriptionId, {
    quantity: activeUsers,
  });
}

export async function updateSubscriptionQuantityForCompany(companyId: string) {
  if (CarbonEdition !== Edition.Cloud) {
    return;
  }

  try {
    const serviceRole = getCarbonServiceRole();

    // Get company plan with plan details
    const companyPlanResult = await serviceRole
      .from("companyPlan")
      .select(
        `
        stripeSubscriptionId,
        plan!inner(
          userBasedPricing
        )
      `
      )
      .eq("id", companyId)
      .single();

    if (companyPlanResult.error || !companyPlanResult.data) {
      console.log(`No company plan found for company ${companyId}`);
      return;
    }

    const { stripeSubscriptionId, plan } = companyPlanResult.data;

    // Only update if userBasedPricing is true and we have a subscription
    if (!plan?.userBasedPricing || !stripeSubscriptionId) {
      return;
    }

    // Count active users
    const activeUsersResult = await serviceRole
      .from("userToCompany")
      .select("userId, ...user(email)")
      .eq("companyId", companyId);

    if (activeUsersResult.error) {
      console.error(
        `Failed to count active users for company ${companyId}:`,
        activeUsersResult.error
      );
      return;
    }

    const activeUserCount =
      activeUsersResult.data?.filter(
        (user) => !(user?.email).includes("@carbonos.dev")
      ).length || 1;

    // Get the subscription from Stripe to find the subscription item
    const subscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );

    if (
      !subscription ||
      !subscription.items ||
      subscription.items.data.length === 0
    ) {
      console.error(
        `No subscription items found for subscription ${stripeSubscriptionId}`
      );
      return;
    }

    // Update the quantity on the first subscription item
    const subscriptionItemId = subscription.items.data[0].id;

    await stripe.subscriptionItems.update(subscriptionItemId, {
      quantity: activeUserCount,
    });

    console.log(
      `Updated Stripe subscription ${stripeSubscriptionId} quantity to ${activeUserCount} for company ${companyId}`
    );
  } catch (error) {
    // Log error but don't throw - we don't want to block user operations
    console.error(
      `Failed to update Stripe subscription quantity for company ${companyId}:`,
      error
    );
  }
}
