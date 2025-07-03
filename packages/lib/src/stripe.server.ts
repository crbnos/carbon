import { getAppUrl, getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
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
          owner: userId,
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
  const customer = await redis.get(`stripe:customer:${customerId}`);
  return KvStripeCustomerSchema.nullish().parse(customer);
}

const KvStripeUserSchema = z.string().nullish();

export async function getStripeCustomerId(companyId: string) {
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

  const serviceRole = await getCarbonServiceRole();
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
    metadata: {
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
  const customerId = await getStripeCustomerId(companyId);
  if (!customerId) {
    throw new Error("Customer not found");
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getAppUrl()}/settings`,
  });

  if (!portalSession.url) {
    throw new Error("Failed to create portal session");
  }

  return portalSession.url;
}

async function insertCompanyPlan(
  client: SupabaseClient<Database>,
  companyPlan: {
    companyId: string;
    planId: string;
    status: "active" | "inactive";
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeSubscriptionStatus?: string;
    subscriptionStartDate?: string;
  }
) {
  const plan = await getPlanById(client, companyPlan.planId);
  if (plan.error) {
    return plan;
  }

  const companyPlanData: Database["public"]["Tables"]["companyPlan"]["Insert"] =
    {
      id: companyPlan.companyId,
      planId: companyPlan.planId,
      tasksLimit: plan.data.tasksLimit,
      aiTokensLimit: plan.data.aiTokensLimit,
      usersLimit: 10, // Default value as defined in the migration
      subscriptionStartDate: new Date().toISOString(),
      stripeSubscriptionStatus: companyPlan.status,
      stripeCustomerId: companyPlan.stripeCustomerId,
      stripeSubscriptionId: companyPlan.stripeSubscriptionId,
      trialPeriodEndsAt: plan.data.stripeTrialPeriodDays
        ? new Date(
            Date.now() + plan.data.stripeTrialPeriodDays * 24 * 60 * 60 * 1000
          ).toISOString()
        : null,
    };

  return client
    .from("companyPlan")
    .upsert(companyPlanData)
    .select("id")
    .single();
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
    const data = event.data.object as Stripe.Checkout.Session;
    const priceId = data.line_items?.data[0]?.price?.id;
    const plan = await getPlanByPriceId(getCarbonServiceRole(), priceId);
    const { customer } = data;
    if (typeof customer !== "string") {
      throw new Error("Stripe webhook handler failed");
    }

    try {
      await Promise.all([
        syncStripeDataToKV(customer),
        insertCompanyPlan(getCarbonServiceRole(), {
          companyId: data.metadata.companyId,
          planId: plan.data.id,
          status: "active",
        }),
      ]);
    } catch (error) {
      console.error("Error processing webhook:", error);
      throw new Error("Stripe webhook handler failed");
    }
  } else if (eventType === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    const priceId = subscription.items.data[0].price.id;
    const plan = await getPlanByPriceId(getCarbonServiceRole(), priceId);
    const { customer } = subscription;
    if (typeof customer !== "string") {
      throw new Error("Stripe webhook handler failed");
    }

    try {
      await Promise.all([
        syncStripeDataToKV(customer),
        updateCompanyPlan(getCarbonServiceRole(), {
          planId: plan.data.id,
          companyId: subscription.metadata.companyId,
          stripeCustomerId: customer,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionStatus: ["active", "trialing"].includes(
            subscription.status
          )
            ? "active"
            : "inactive",
          subscriptionStartDate: new Date(
            subscription.items.data[0].current_period_start * 1000
          ).toISOString(),
        }),
      ]);
    } catch (error) {
      console.error("Error processing webhook:", error);
      throw new Error("Stripe webhook handler failed");
    }
  }
}

export async function syncStripeDataToKV(customerId: string) {
  const key = `stripe:customer:${customerId}`;
  console.log({ key });

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

  const subscription = subscriptions.data[0];

  const subData = KvStripeCustomerSchema.parse({
    subscriptionId: subscription.id,
    status: subscription.status,
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

  const customer = await stripe.customers.retrieve(customerId);
  const companyId = (customer as any).metadata?.companyId;

  if (companyId) {
    await redis.set(key, subData);
  }

  return subData;
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

export async function updateCompanyPlan(
  client: SupabaseClient<Database>,
  data: {
    companyId: string;
    planId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripeSubscriptionStatus: string;
    subscriptionStartDate: string;
  }
) {
  // Extract companyId and build the update data without it
  const { companyId, ...updateData } = data;

  return client.from("companyPlan").update(updateData).eq("id", companyId);
}
