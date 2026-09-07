import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  createConnectAccountLink,
  getOrCreateConnectAccount
} from "@carbon/stripe/stripe.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

const logger = getLogger("stripe-connect");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const returnUrl = `${url.origin}/api/integrations/stripe-connect/callback?status=success`;
  const refreshUrl = `${url.origin}/api/integrations/stripe-connect/callback?status=refresh`;

  try {
    const stripeAccountId = await getOrCreateConnectAccount(
      client,
      companyId,
      email
    );

    const onboardingUrl = await createConnectAccountLink(
      stripeAccountId,
      returnUrl,
      refreshUrl
    );

    if (
      request.headers.get("Accept")?.includes("application/json") ||
      request.method === "POST"
    ) {
      return Response.json({ redirectUrl: onboardingUrl });
    }

    return redirect(onboardingUrl);
  } catch (err: any) {
    logger.error("Failed to initiate Stripe Connect onboarding", {
      error: err
    });

    if (
      request.headers.get("Accept")?.includes("application/json") ||
      request.method === "POST"
    ) {
      return Response.json(
        {
          error: err.message || "Failed to initiate Stripe Connect onboarding"
        },
        { status: 400 }
      );
    }

    throw redirect(
      path.to.integrations,
      await flash(
        request,
        error(err, "Failed to initiate Stripe Connect onboarding")
      )
    );
  }
}

export async function action({ request }: ActionFunctionArgs) {
  return loader({ request } as any);
}
