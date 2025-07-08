import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";
import { config } from "dotenv";
import { Stripe } from "stripe";
import { z } from "zod";
import { companies } from "./data/stripe-customers";
config();

const PROD = true;

const upstashRedisRestUrl = PROD
  ? process.env.PROD_UPSTASH_REDIS_REST_URL
  : process.env.UPSTASH_REDIS_REST_URL;
const upstashRedisRestToken = PROD
  ? process.env.PROD_UPSTASH_REDIS_REST_TOKEN
  : process.env.UPSTASH_REDIS_REST_TOKEN;

if (!upstashRedisRestUrl) {
  throw new Error("UPSTASH_REDIS_REST_URL is not defined");
}

if (!upstashRedisRestToken) {
  throw new Error("UPSTASH_REDIS_REST_TOKEN is not defined");
}

const redis = new Redis({
  url: upstashRedisRestUrl,
  token: upstashRedisRestToken,
});

const supabaseUrl = PROD
  ? process.env.PROD_SUPABASE_URL
  : process.env.SUPABASE_URL;
const supabaseServiceRoleKey = PROD
  ? process.env.PROD_SUPABASE_SERVICE_ROLE_KEY
  : process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is not defined");
}

if (!supabaseServiceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not defined");
}

const stripeSecretKey = PROD
  ? process.env.PROD_STRIPE_SECRET_KEY!
  : process.env.STRIPE_SECRET_KEY!;

if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is not defined");
}

const client = createClient(supabaseUrl, supabaseServiceRoleKey);

const stripe = new Stripe(stripeSecretKey, {
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

(async () => {
  for await (const company of companies) {
    console.log(company.name);
    const customerKey = `stripe:customer:${company.customerId}`;
    const companyKey = `stripe:company:${company.id}`;

    await redis.set(companyKey, company.customerId);

    const subscription = await getSubscription(company.customerId);
    if (!subscription) {
      await redis.del(customerKey);
      return null;
    }

    console.log(subscription.id);
  }
})();

async function getSubscription(customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    limit: 1,
    status: "all",
    expand: ["data.default_payment_method"],
  });

  return subscriptions.data[0];
}

async function getPlanByPriceId(
  client: SupabaseClient<Database>,
  priceId: string
) {
  return await client
    .from("plan")
    .select("*")
    .eq("stripePriceId", priceId)
    .single();
}

async function upsertCompanyPlan(
  client: SupabaseClient<Database>,
  companyPlan: {
    companyId: string;
    priceId: string;
    status?: "Active" | "Inactive" | "Canceled";
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionStartDate?: string;
  }
) {
  const plan = await getPlanByPriceId(client, companyPlan.priceId);
  if (plan.error) {
    console.error("upsertCompanyPlan - plan error:", plan.error);
    return plan;
  }

  const companyPlanData: Database["public"]["Tables"]["companyPlan"]["Insert"] =
    {
      id: companyPlan.companyId,
      planId: plan.data.id,
      tasksLimit: plan.data.tasksLimit,
      aiTokensLimit: plan.data.aiTokensLimit,
      usersLimit: 10, // Default value as defined in the migration
      subscriptionStartDate:
        companyPlan.subscriptionStartDate || new Date().toISOString(),
      stripeSubscriptionStatus: companyPlan.status,
      stripeCustomerId: companyPlan.stripeCustomerId,
      stripeSubscriptionId: companyPlan.stripeSubscriptionId,
    };

  return client.from("companyPlan").upsert(companyPlanData);
}
