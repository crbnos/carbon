import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "./stripe.server";

const log = getLogger("stripe-connect");

export async function getOrCreateConnectAccount(
  client: SupabaseClient<Database>,
  companyId: string,
  userEmail: string
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  // 1. Check if company already has a companyIntegration row for stripe-connect
  const existingIntegration = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("id", "stripe-connect")
    .eq("companyId", companyId)
    .maybeSingle();

  const existingMeta = existingIntegration.data?.metadata as
    | Record<string, unknown>
    | undefined;
  let stripeAccountId = existingMeta?.stripeAccountId as string | undefined;

  if (stripeAccountId) {
    return stripeAccountId;
  }

  // 2. Fetch company details to pre-populate Stripe Connect onboarding form
  const company = await client
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();

  if (company.error || !company.data) {
    throw new Error("Failed to load company details for Stripe Connect.");
  }

  const comp = company.data;

  // 3. Create Stripe Express Connected Account with pre-populated company information
  const account = await stripe.accounts.create({
    type: "express",
    country: comp.countryCode || "US",
    email: comp.email || userEmail,
    business_type: "company",
    company: {
      name: comp.name,
      tax_id: comp.taxId || undefined,
      phone: comp.phone || undefined,
      address: {
        line1: comp.addressLine1 || undefined,
        line2: comp.addressLine2 || undefined,
        city: comp.city || undefined,
        state: comp.stateProvince || undefined,
        postal_code: comp.postalCode || undefined,
        country: comp.countryCode || "US"
      }
    },
    business_profile: {
      name: comp.name,
      url: comp.website || undefined,
      support_email: comp.email || userEmail,
      support_phone: comp.phone || undefined
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: {
      companyId
    }
  });

  stripeAccountId = account.id;

  // 4. Save account ID to companyIntegration
  await client.from("companyIntegration").upsert({
    id: "stripe-connect",
    companyId,
    active: false,
    metadata: {
      stripeAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted
    }
  });

  return stripeAccountId;
}

export async function createConnectAccountLink(
  stripeAccountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: "account_onboarding"
  });

  return accountLink.url;
}

export async function getConnectAccountStatus(stripeAccountId: string) {
  if (!stripe) {
    return null;
  }

  try {
    const account = await stripe.accounts.retrieve(stripeAccountId);
    return {
      stripeAccountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      email: account.email,
      displayName:
        account.settings?.dashboard?.display_name ||
        account.business_profile?.name ||
        undefined
    };
  } catch (err) {
    log.error("Failed to retrieve Stripe Connect account status", {
      error: err
    });
    return null;
  }
}

export async function createExpressDashboardLoginLink(
  stripeAccountId: string
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe secret key is not configured.");
  }

  const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
  return loginLink.url;
}
