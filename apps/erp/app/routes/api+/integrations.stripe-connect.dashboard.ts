// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { rejectCrossSiteNavigation } from "@carbon/auth/middleware/security.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { getConnectDashboardUrl } from "@carbon/stripe/connect.server";
import { redirect, redirectExternal } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
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
    const dashboardUrl = await getConnectDashboardUrl(stripeAccountId);

    if (
      request.headers.get("Accept")?.includes("application/json") ||
      request.method === "POST"
    ) {
      return Response.json({ redirectUrl: dashboardUrl });
    }

    return redirectExternal(dashboardUrl);
  } catch (err: any) {
    logger.error("Failed to open the Stripe Dashboard", {
      companyId,
      stripeAccountId,
      error: err
    });

    if (
      request.headers.get("Accept")?.includes("application/json") ||
      request.method === "POST"
    ) {
      return Response.json(
        { error: err.message || "Failed to open the Stripe Dashboard" },
        { status: 400 }
      );
    }

    throw redirect(
      path.to.integrations,
      await flash(request, error(err, "Failed to open the Stripe Dashboard"))
    );
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Writes on GET: a link on another site must not trigger it.
  rejectCrossSiteNavigation(request);
  return handle({ request });
}

export async function action({ request }: ActionFunctionArgs) {
  return handle({ request });
}
