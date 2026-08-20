import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getConnectAccountStatus } from "@carbon/stripe/connect.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

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

    await upsertCompanyIntegration(client, {
      id: "stripe-connect",
      companyId,
      active: true,
      metadata: {
        ...existingMeta,
        ...accountStatus
      },
      updatedBy: userId
    });

    if (statusParam === "refresh") {
      throw redirect(
        path.to.api.stripeConnectOnboard,
        await flash(
          request,
          error(
            null,
            "Stripe Connect onboarding link expired. Please try again."
          )
        )
      );
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

  throw redirect(path.to.integration("stripe-connect"));
}
