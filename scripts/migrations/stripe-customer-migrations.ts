import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";
import { config } from "dotenv";
import { Stripe } from "stripe";
import { z } from "zod";
import { localCompanies, productionCompanies } from "./data/stripe-customers";
config();

const PROD = false;

const companies = PROD ? productionCompanies : localCompanies;

const upstashRedisRestUrl = PROD
  ? process.env.PROD_UPSTASH_REDIS_REST_URL
  : process.env.UPSTASH_REDIS_REST_URL;
const upstashRedisRestToken = PROD
  ? process.env.PROD_UPSTASH_REDIS_REST_TOKEN
  : process.env.UPSTASH_REDIS_REST_TOKEN;

if (!upstashRedisRestUrl) {
  throw new Error(
    PROD
      ? "PROD_UPSTASH_REDIS_REST_URL is not defined"
      : "UPSTASH_REDIS_REST_URL is not defined"
  );
}

if (!upstashRedisRestToken) {
  throw new Error(
    PROD
      ? "PROD_UPSTASH_REDIS_REST_TOKEN is not defined"
      : "UPSTASH_REDIS_REST_TOKEN is not defined"
  );
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
  throw new Error(
    PROD ? "PROD_SUPABASE_URL is not defined" : "SUPABASE_URL is not defined"
  );
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    PROD
      ? "PROD_SUPABASE_SERVICE_ROLE_KEY is not defined"
      : "SUPABASE_SERVICE_ROLE_KEY is not defined"
  );
}

const stripeSecretKey = PROD
  ? process.env.PROD_STRIPE_SECRET_KEY!
  : process.env.STRIPE_SECRET_KEY!;

if (!stripeSecretKey) {
  throw new Error(
    PROD
      ? "PROD_STRIPE_SECRET_KEY is not defined"
      : "STRIPE_SECRET_KEY is not defined"
  );
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
  planId: z.string().nullable(),
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
    const companyId = company.id;
    const customerId = company.customerId;
    console.log(company.name);
    if (!companyId) {
      throw new Error("Company ID is required");
    }

    if (!customerId) {
      throw new Error("Customer ID is required");
    }

    const customerKey = `stripe:customer:${customerId}`;
    const companyKey = `stripe:company:${company.id}`;

    await redis.set(companyKey, customerId);

    const subscription = await getSubscription(customerId);
    if (!subscription) {
      await redis.del(customerKey);
      return null;
    }

    const plan = await getPlanByPriceId(
      client,
      subscription.items.data[0].price.id
    );

    if (plan.error) {
      console.error("Failed to get plan by price id:", plan.error);
      continue;
    }

    const subDataResult = KvStripeCustomerSchema.safeParse({
      subscriptionId: subscription.id,
      status: subscription.status,
      priceId: subscription.items.data[0].price.id,
      planId: plan.data?.id ?? null,
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
        redis.set(customerKey, subData),
        upsertCompanyPlan(client, companyPlanData),
        updateCompanyOwner(client, companyId, company.ownerId),
      ]);

      if (companyPlan.error) {
        console.error("Failed to upsert company plan:", companyPlan.error);
      }
    } else {
      console.error("no company id, skipping company plan upsert");
    }
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

async function updateCompanyOwner(
  client: SupabaseClient<Database>,
  companyId: string,
  ownerId: string
) {
  return client.from("company").update({ ownerId }).eq("id", companyId);
}

async function upsertCompanyPlan(
  client: SupabaseClient<Database>,
  companyPlan: Database["public"]["Tables"]["companyPlan"]["Insert"]
) {
  return client.from("companyPlan").upsert(companyPlan);
}
