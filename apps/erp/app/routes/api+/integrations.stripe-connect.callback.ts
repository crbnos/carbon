// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { getConnectAccountStatus } from "@carbon/stripe/connect.server";
import { getRequestOrigin, redirect, redirectExternal } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

const logger = getLogger("erp", "stripe-connect", "callback");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");

  // Get current integration metadata
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
    throw redirect(
      path.to.integration("stripe-connect"),
      await flash(request, error(null, "No Stripe Connect account found"))
    );
  }

  const accountStatus = await getConnectAccountStatus(stripeAccountId);

  if (accountStatus) {
    const onboardingComplete =
      !!accountStatus.detailsSubmitted && !!accountStatus.chargesEnabled;

    const update = await upsertCompanyIntegration(client, {
      id: "stripe-connect",
      companyId,
      active: true,
      metadata: {
        ...existingMeta,
        ...accountStatus
      },
      updatedBy: userId
    });

    if (update.error) {
      logger.error("Failed to save the Stripe Connect account status", {
        companyId,
        stripeAccountId,
        error: update.error
      });
      throw redirect(
        path.to.integration("stripe-connect"),
        await flash(
          request,
          error(update.error, "Failed to save your Stripe account status")
        )
      );
    }

    if (statusParam === "refresh") {
      // The onboarding link expired. Stripe sent the browser here from
      // stripe.com, so the new link is made here: the connect route refuses a
      // cross-site GET, because a GET there can create a Stripe account. This
      // only ever continues the account the company already has.
      const api = await carbon(request);
      const origin = getRequestOrigin(request) ?? url.origin;
      const restarted = await api.shared.startStripeConnectOnboarding({
        origin
      });
      if (restarted.error) {
        throw redirect(
          path.to.integration("stripe-connect"),
          await flash(request, error(restarted.error, restarted.error.message))
        );
      }
      return redirectExternal(restarted.data.redirectUrl);
    }

    if (onboardingComplete) {
      throw redirect(
        path.to.integration("stripe-connect"),
        await flash(
          request,
          success("Stripe Connect account successfully connected and enabled!")
        )
      );
    } else {
      throw redirect(
        path.to.integration("stripe-connect"),
        await flash(
          request,
          success(
            "Stripe Connect details saved. Onboarding is pending completion."
          )
        )
      );
    }
  }

  // getConnectAccountStatus already logged the Stripe error.
  logger.error("Could not read the Stripe Connect account status", {
    companyId,
    stripeAccountId
  });
  throw redirect(
    path.to.integration("stripe-connect"),
    await flash(
      request,
      error(null, "Could not read your Stripe account status. Try again.")
    )
  );
}
