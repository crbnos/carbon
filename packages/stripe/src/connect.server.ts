import type { Database } from "@carbon/database";
import { STRIPE_SECRET_KEY } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Stripe } from "stripe";
import { STRIPE_CONNECT_ACCOUNT_CONFIG } from "./connect.constants";
import { stripe } from "./stripe.server";

const log = getLogger("stripe-connect");

const stripeConnect = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-07-29.dahlia",
      typescript: true
    })
  : null;

function deriveConnectAccountMetadata(account: Stripe.V2.Core.Account) {
  const capabilities = account.configuration?.merchant?.capabilities;
  const entries = account.requirements?.entries ?? [];
  const requirementErrors = entries
    .flatMap((entry) => entry.errors ?? [])
    .map((requirementError) => requirementError.description);

  return {
    chargesEnabled: capabilities?.card_payments?.status === "active",
    payoutsEnabled: capabilities?.stripe_balance?.payouts?.status === "active",
    detailsSubmitted: !entries.length,
    requirementErrors
  };
}

export async function getOrCreateConnectAccount(
  client: SupabaseClient<Database>,
  companyId: string,
  userEmail: string
): Promise<string> {
  if (!stripeConnect) {
    throw new Error("Stripe secret key is not configured.");
  }
  // TODO: Should I also fetch stripe connect capability here?
  // 1. Check if company already has a companyIntegration row for stripe-connect
  const existingIntegration = await client
    .from("companyIntegration")
    .select("metadata, active")
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
  const countryCode = comp.countryCode || "US";
  const contactEmail = comp.email || userEmail;

  const account = await stripeConnect.v2.core.accounts.create({
    contact_email: contactEmail,
    display_name: comp.name,
    dashboard: STRIPE_CONNECT_ACCOUNT_CONFIG.dashboard,
    identity: {
      country: countryCode,
      entity_type: STRIPE_CONNECT_ACCOUNT_CONFIG.entityType,
      business_details: {
        registered_name: comp.name,
        phone: comp.phone || undefined,
        address: {
          line1: comp.addressLine1 || undefined,
          line2: comp.addressLine2 || undefined,
          city: comp.city || undefined,
          state: comp.stateProvince || undefined,
          postal_code: comp.postalCode || undefined,
          country: countryCode
        }
      }
    },
    configuration: {
      merchant: {
        // stripe_balance.payouts (which replaces v1's `transfers` capability) has no
        // separate opt-in on Merchant configuration create — it activates once the
        // merchant configuration itself is applied and verification requirements clear.
        capabilities: {
          ach_debit_payments: { requested: true },
          card_payments: { requested: true }
        },
        support: {
          email: contactEmail,
          phone: comp.phone || undefined
        }
      }
    },
    defaults: {
      responsibilities: {
        fees_collector:
          STRIPE_CONNECT_ACCOUNT_CONFIG.responsibilities.feesCollector,
        losses_collector:
          STRIPE_CONNECT_ACCOUNT_CONFIG.responsibilities.lossesCollector
      }
    },
    metadata: {
      companyId
    },
    include: ["configuration.merchant", "requirements"]
  });

  stripeAccountId = account.id;

  await client.from("companyIntegration").upsert({
    id: "stripe-connect",
    companyId,
    active: true,
    metadata: {
      ...existingMeta,
      stripeAccountId,
      ...deriveConnectAccountMetadata(account)
    }
  });

  return stripeAccountId;
}

export async function createConnectAccountLink(
  stripeAccountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<string> {
  if (!stripeConnect) {
    throw new Error("Stripe secret key is not configured.");
  }

  const accountLink = await stripeConnect.v2.core.accountLinks.create({
    account: stripeAccountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant"],
        return_url: returnUrl,
        refresh_url: refreshUrl
      }
    }
  });

  return accountLink.url;
}

export async function getConnectAccountStatus(stripeAccountId: string) {
  if (!stripeConnect) {
    return null;
  }

  try {
    const account = await stripeConnect.v2.core.accounts.retrieve(
      stripeAccountId,
      {
        include: ["configuration.merchant", "requirements"]
      }
    );

    return {
      stripeAccountId: account.id,
      ...deriveConnectAccountMetadata(account),
      email: account.contact_email,
      displayName: account.display_name
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

  // Express Dashboard login links remain a v1 endpoint. Per Stripe's v2/v1
  // interoperability model, v1 endpoints accept v2-created Account IDs directly, so
  // this stays on the shared v1-pinned client rather than the Connect v2 client.
  const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
  return loginLink.url;
}
