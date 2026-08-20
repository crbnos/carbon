import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { createExpressDashboardLoginLink } from "@carbon/stripe/connect.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

const logger = getLogger("stripe-connect");

async function handle({ request }: { request: Request }) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const existing = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("id", "stripe-connect")
    .eq("companyId", companyId)
    .maybeSingle();

  const existingMeta = existing.data?.metadata as
    | Record<string, unknown>
    | undefined;
  const stripeAccountId = existingMeta?.stripeAccountId as string | undefined;

  if (!stripeAccountId) {
    if (
      request.headers.get("Accept")?.includes("application/json") ||
      request.method === "POST"
    ) {
      return Response.json(
        { error: "No Stripe Connect account found" },
        { status: 400 }
      );
    }
    throw redirect(
      path.to.integrations,
      await flash(request, error(null, "No Stripe Connect account found"))
    );
  }

  try {
    const loginLinkUrl = await createExpressDashboardLoginLink(stripeAccountId);

    if (
      request.headers.get("Accept")?.includes("application/json") ||
      request.method === "POST"
    ) {
      return Response.json({ redirectUrl: loginLinkUrl });
    }

    return redirect(loginLinkUrl);
  } catch (err: any) {
    logger.error("Failed to open Stripe Express Dashboard", { error: err });

    if (
      request.headers.get("Accept")?.includes("application/json") ||
      request.method === "POST"
    ) {
      return Response.json(
        { error: err.message || "Failed to open Stripe Express Dashboard" },
        { status: 400 }
      );
    }

    throw redirect(
      path.to.integrations,
      await flash(
        request,
        error(err, "Failed to open Stripe Express Dashboard")
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
