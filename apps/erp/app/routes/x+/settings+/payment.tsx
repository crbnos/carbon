import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getBillingPortalRedirectUrl } from "@carbon/stripe/stripe.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Payment",
  to: path.to.settingsPayment,
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "billing-portal") {
    try {
      const billingPortalUrl = await getBillingPortalRedirectUrl({ companyId });
      return redirect(billingPortalUrl, 301);
    } catch (err) {
      console.error("Failed to get billing portal URL:", err);
      return json(
        {},
        await flash(request, error("Failed to access billing portal"))
      );
    }
  }

  return json({}, await flash(request, error("Invalid intent")));
}

// This route now only handles actions - UI is in the company route
export default function PaymentSettings() {
  return null;
}
