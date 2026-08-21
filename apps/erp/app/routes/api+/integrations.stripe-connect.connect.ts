import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  createConnectAccountLink,
  getOrCreateConnectAccount,
  isStaleConnectAccountError
} from "@carbon/stripe/connect.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

const logger = getLogger("stripe-connect");

async function handle({ request }: { request: Request }) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const returnUrl = `${url.origin}/api/integrations/stripe-connect/callback?status=success`;
  const refreshUrl = `${url.origin}/api/integrations/stripe-connect/callback?status=refresh`;

  try {
    let stripeAccountId = await getOrCreateConnectAccount(
      client,
      companyId,
      email
    );

    let onboardingUrl: string;
    try {
      onboardingUrl = await createConnectAccountLink(
        stripeAccountId,
        returnUrl,
        refreshUrl
      );
    } catch (linkErr) {
      if (!isStaleConnectAccountError(linkErr)) {
        throw linkErr;
      }

      logger.warn(
        "Stripe Connect account link failed against the stored account; creating a new account",
        { companyId, stripeAccountId, error: linkErr }
      );

      stripeAccountId = await getOrCreateConnectAccount(
        client,
        companyId,
        email,
        { forceNew: true }
      );

      onboardingUrl = await createConnectAccountLink(
        stripeAccountId,
        returnUrl,
        refreshUrl
      );
    }

    const existing = await client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", "stripe-connect")
      .eq("companyId", companyId)
      .maybeSingle();
    const upsert = await client.from("companyIntegration").upsert({
      id: "stripe-connect",
      companyId,
      active: true,
      metadata: {
        ...(existing.data?.metadata as Record<string, unknown> | undefined),
        stripeAccountId,
        onboardingStarted: true // mark started on try
      }
    });

    if (upsert.error) {
      // Silent failure here leaves no `stripeAccountId` on the integration
      // row — the callback would then throw "No Stripe Connect account
      // found." Throw so this hits the catch below and surfaces to the user
      // instead of onboarding silently against an unrecorded account.
      throw new Error(
        `Failed to save Stripe Connect account id: ${upsert.error.message}`
      );
    }

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

export async function loader({ request }: LoaderFunctionArgs) {
  return handle({ request });
}

export async function action({ request }: ActionFunctionArgs) {
  return handle({ request });
}
