import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getStripeCustomerId,
  processStripeEvent,
  syncStripeDataToKV,
} from "~/lib/stripe.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const customerId = await getStripeCustomerId(companyId);
  if (customerId) {
    await syncStripeDataToKV(customerId);
  }

  throw redirect(path.to.authenticatedRoot);
}

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    console.error("No signature");
    return json({ error: "No signature" }, { status: 400 });
  }

  try {
    await processStripeEvent({ body, signature });
    return json({ success: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return json({ error: "Webhook processing failed" }, { status: 400 });
  }
}
