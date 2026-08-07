import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  createConnectAccountLink,
  getOrCreateConnectAccount
} from "@carbon/stripe/connect.server";
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

    // Onboarding is considered "started" the moment we've generated a link to
    // send the user to Stripe with — regardless of whether they actually
    // click through, same as Email's required fields only prove the values
    // were submitted, not that they're correct. This is what the generic
    // settings-form schema requires before it'll let the row be marked
    // installed (see StripeConnectSettingsSchema.onboardingStarted).
    const existing = await client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", "stripe-connect")
      .eq("companyId", companyId)
      .maybeSingle();
    await client.from("companyIntegration").upsert({
      id: "stripe-connect",
      companyId,
      active: true,
      metadata: {
        ...(existing.data?.metadata as Record<string, unknown> | undefined),
        stripeAccountId,
        onboardingStarted: true
      }
    });

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

    // "platform_account_required" is Stripe's code for "your own Stripe
    // account isn't set up as a Connect platform" — a genuine admin-fixable
    // platform misconfiguration, distinct from an ordinary per-request
    // failure. Surface it distinctly so the drawer can show a persistent
    // "ask your administrator" state instead of a one-off retryable toast.
    const code = err.code ?? err.raw?.code;
    const isPlatformConfigError = code === "platform_account_required";

    if (
      request.headers.get("Accept")?.includes("application/json") ||
      request.method === "POST"
    ) {
      return Response.json(
        {
          error: err.message || "Failed to initiate Stripe Connect onboarding",
          code,
          isPlatformConfigError
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
