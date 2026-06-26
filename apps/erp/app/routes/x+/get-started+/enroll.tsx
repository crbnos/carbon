import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { enrollImplementation } from "@carbon/onboarding/server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { path } from "~/utils/path";

const INTERNAL_DOMAINS = ["@carbon.us.org", "@carbon.ms"];

// Internal-only: enroll the CURRENT company into the Implementation Hub so staff
// can flip an existing company without creating a fresh signup. New Cloud
// signups enroll automatically (onboarding+/company.tsx).
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId, email } = await requirePermissions(request, {});

  const isInternal = INTERNAL_DOMAINS.some((domain) =>
    email.toLowerCase().trim().endsWith(domain)
  );
  if (!isInternal) {
    return data(
      { success: false },
      await flash(
        request,
        error(new Error("forbidden"), "Only Carbon staff can enroll a company")
      )
    );
  }

  const serviceRole = getCarbonServiceRole();
  const result = await enrollImplementation(serviceRole, {
    companyId,
    userId,
    tier: "self_serve"
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to enroll company"))
    );
  }

  throw redirect(path.to.getStarted);
}
