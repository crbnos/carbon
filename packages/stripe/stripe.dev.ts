import { spawn } from "child_process";
import { config } from "dotenv";
import type Stripe from "stripe";

config();

const CARBON_EDITION = process.env.CARBON_EDITION;
if (CARBON_EDITION !== "cloud") {
  console.log("🔄 Stripe webhook endpoint is not needed in this edition");
  process.exit(0);
}

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is required");
}

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

// Events raised on CONNECTED accounts (Stripe Connect). These arrive on a
// separate CLI stream (`--forward-connect-to`) with their OWN signing secret —
// the one the CLI prints as the "connect" secret, which belongs in
// STRIPE_CONNECT_WEBHOOK_SECRET, not STRIPE_WEBHOOK_SECRET.
const connectEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.marked_uncollectible",
];

console.log("🔄 Setting up Stripe webhook endpoint...");

const url = `${process.env.VERCEL_URL}/api/webhook/stripe`;
const connectUrl = `${process.env.VERCEL_URL}/api/webhook/stripe-connect`;
console.log("🔄 Webhook URL:", url);
console.log("🔄 Connect webhook URL:", connectUrl);

if (!url.includes("localhost:")) {
  throw new Error("Running in production mode");
}
console.log("🔄 Running in local development mode");
console.log("🔄 Starting Stripe CLI webhook forwarder...");

// Two listeners rather than one: a single `stripe listen` signs everything it
// forwards with the same secret, so account and connect events must be split to
// keep their secrets distinct (matching how the deployed endpoints are signed).
const stripeProcess = spawn("stripe", [
  "listen",
  "--events",
  events.join(","),
  "--forward-to",
  url,
]);

const stripeConnectProcess = spawn("stripe", [
  "listen",
  "--events",
  connectEvents.join(","),
  "--forward-connect-to",
  connectUrl,
]);

const processes = [
  { name: "account", process: stripeProcess },
  { name: "connect", process: stripeConnectProcess },
];

for (const { name, process: child } of processes) {
  child.stdout.on("data", (data) => {
    console.log(`[${name}] ${data}`);
    if (data.toString().includes("Ready!")) {
      console.log(`✅ Stripe CLI ${name} webhook forwarder is ready`);
    }
  });

  child.stderr.on("data", (data) => {
    console.error(`[${name}] ${data}`);
  });

  child.on("close", (code) => {
    if (code !== 0) {
      console.error(
        `❌ Stripe CLI ${name} webhook forwarder exited with code ${code}`
      );
      process.exit(1);
    }
  });
}

// Keep the process running
process.on("SIGINT", () => {
  for (const { process: child } of processes) {
    child.kill();
  }
  process.exit(0);
});
