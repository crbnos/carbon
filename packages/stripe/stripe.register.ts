import Stripe from "stripe";

import { config } from "dotenv";
config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const VERCEL_URL = process.env.VERCEL_URL;
const ERP_URL = process.env.ERP_URL;

if (!STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY is required");
  process.exit(1);
}

if (!VERCEL_URL) {
  console.error("❌ VERCEL_URL is required");
  process.exit(1);
}

// Initialize Stripe
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-06-30.basil",
});

// Define the events to listen for (same as in stripe.dev.ts)
const events: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "customer.subscription.trial_will_end",
  "invoice.sent",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.upcoming",
  "invoice.marked_uncollectible",
  "invoice.payment_succeeded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
];

const connectEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.marked_uncollectible",
];

// const webhookUrl = `https://${VERCEL_URL}/api/webhook/stripe`;
const webhookUrl = `${ERP_URL}/api/webhook/stripe`;
const connectWebhookUrl = `${ERP_URL}/api/webhook/stripe-connect`;
if (webhookUrl.includes("localhost")) {
  throw new Error("Cannot register webhook in local development mode");
}

async function registerWebhook({
  url,
  enabledEvents,
  connect,
  secretEnvVar,
}: {
  url: string;
  enabledEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[];
  connect: boolean;
  secretEnvVar: string;
}) {
  console.log(`🔄 Registering Stripe webhook for ${url}...`);

  try {
    // First, list existing webhooks to avoid duplicates. Stripe's default
    // page size is 10 — without an explicit limit, an account with more than
    // 10 webhooks would miss the existing endpoint here and create a
    // duplicate on every run.
    const existingEndpoints = await stripe.webhookEndpoints.list({
      limit: 100,
    });

    // Check if we already have a webhook for this URL
    const existingEndpoint = existingEndpoints.data.find(
      (endpoint) => endpoint.url === url
    );

    if (existingEndpoint) {
      console.log(`ℹ️ Webhook already exists for ${url}`);
      console.log(`ℹ️ Webhook ID: ${existingEndpoint.id}`);
      console.log(
        `ℹ️ Updating webhook to ensure it has the correct event types...`
      );

      // Update the existing webhook with the current event types. `connect` is
      // fixed at creation and cannot be updated — recreate the endpoint if it
      // needs to change.
      const updatedEndpoint = await stripe.webhookEndpoints.update(
        existingEndpoint.id,
        {
          enabled_events: enabledEvents,
        }
      );

      console.log(`✅ Webhook updated successfully!`);
      return updatedEndpoint;
    }

    // Create a new webhook endpoint
    const endpoint = await stripe.webhookEndpoints.create({
      url,
      enabled_events: enabledEvents,
      connect,
      description: `Webhook for ${VERCEL_URL}`,
    });

    console.log(`✅ Webhook registered successfully!`);
    console.log(`ℹ️ Webhook ID: ${endpoint.id}`);
    console.log(`ℹ️ Webhook Secret: ${endpoint.secret}`);
    console.log(`
⚠️ IMPORTANT: Add this webhook secret to your environment variables:
${secretEnvVar}=${endpoint.secret}
`);

    return endpoint;
  } catch (error) {
    console.error(`❌ Error registering webhook:`, error);
    throw error;
  }
}

async function registerWebhooks() {
  await registerWebhook({
    url: webhookUrl,
    enabledEvents: events,
    connect: false,
    secretEnvVar: "STRIPE_WEBHOOK_SECRET",
  });
  await registerWebhook({
    url: connectWebhookUrl,
    enabledEvents: connectEvents,
    connect: true,
    secretEnvVar: "STRIPE_CONNECT_WEBHOOK_SECRET",
  });
}

registerWebhooks()
  .then(() => {
    console.log(`
🎉 All done! Your Stripe webhooks are now registered.
📝 Remember to add the webhook secrets to your Vercel environment variables.
`);
  })
  .catch((error) => {
    console.error(`❌ Failed to register webhook:`, error);
    process.exit(1);
  });
