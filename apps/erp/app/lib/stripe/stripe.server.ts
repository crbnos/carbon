/**
 * Integrate Stripe with a KV store.
 */
import { redis } from "@carbon/kv";
import { redirect } from "@vercel/remix";
import { Stripe } from "stripe";
import { z } from "zod";
import { path } from "~/utils/path";
import { getPlans } from "./plans";

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

export async function getStripeCustomer(customerId: string) {
  const customer = await redis.get(`stripe:customer:${customerId}`);
  return KvStripeCustomerSchema.nullish().parse(customer);
}

const KvStripeUserSchema = z.string().nullish();

export async function getStripeCustomerId(userId: string) {
  return KvStripeUserSchema.parse(await redis.get(`stripe:user:${userId}`));
}

export async function createStripeCustomer({
  companyId,
  email,
  name,
}: {
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
          companyId,
        },
      },
      {
        idempotencyKey: companyId,
      }
    );

    // Store the relation between userId and stripeCustomerId in KV
    await redis.set(
      `stripe:user:${companyId}`,
      KvStripeUserSchema.parse(customer.id)
    );

    return customer;
  } catch (error) {
    console.error("Error creating Stripe customer:", error);
    throw error;
  }
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

  const { customer } = event.data.object;
  if (typeof customer !== "string") {
    throw new Error("Stripe webhook handler failed");
  }

  try {
    await syncStripeDataToKV(customer);
  } catch (error) {
    console.error("Error processing webhook:", error);
    throw new Error("Stripe webhook handler failed");
  }
}

export async function syncStripeDataToKV(customerId: string) {
  const key = `stripe:customer:${customerId}`;

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

  await redis.set(key, subData);
  return subData;
}

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

function isAllowedEventType<TEvent extends Stripe.Event>(
  event: TEvent
): event is TEvent & { type: AllowedEventType } {
  return allowedEventTypes.includes(event.type as AllowedEventType);
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

export async function redirectToCheckout({
  companyId,
  email,
  name,
}: {
  companyId: string;
  email: string;
  name?: string | null;
}) {
  const customerId = await getStripeCustomerId(companyId);
  let stripeCustomerId = customerId;

  if (!stripeCustomerId) {
    // Create a new customer if one doesn't exist
    const customer = await createStripeCustomer({
      companyId,
      email,
      name,
    });
    stripeCustomerId = customer.id;
  }

  const plans = await getPlans();
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    line_items: [
      {
        price: plans.find((plan) => plan.id === "PRO")?.priceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${process.env.VERCEL_URL}/api/webhook/stripe`,
    cancel_url: `${process.env.VERCEL_URL}/api/webhook/stripe`,
    metadata: {
      companyId,
    },
  });

  if (!checkoutSession.url) {
    throw new Error("Failed to create checkout session");
  }

  return checkoutSession.url;
}

export async function redirectToBillingPortal({
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
    return_url: `${process.env.VERCEL_URL}${path.to.settings}`,
  });

  if (!portalSession.url) {
    throw new Error("Failed to create portal session");
  }

  redirect(portalSession.url);
}
