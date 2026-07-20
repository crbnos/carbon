import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import {
  getStripeCustomerId,
  processStripeEvent,
  syncStripeDataToKV
} from "@carbon/stripe/stripe.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { path } from "~/utils/path";

const logger = getLogger("erp", "webhook-stripe");

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
    logger.error("No signature");
    return data({ error: "No signature" }, { status: 400 });
  }

  try {
    await processStripeEvent({ body, signature });
    return { success: true };
  } catch (error) {
    logger.error("Stripe webhook error", { error: error });
    return data({ error: "Webhook processing failed" }, { status: 400 });
  }
}
