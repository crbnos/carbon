import { getConnectAccountStatus } from "@carbon/stripe/connect.server";

// Only runs once `companyIntegration.active` is already true, which now only
// happens once a real Stripe account exists (see getOrCreateConnectAccount) —
// the "no account at all" case is already "inactive" for free via the
// generic `!integration.active` check upstream in getIntegrationHealth.
//
// Returns true only when the account is fully onboarded (charges + payouts
// both live). Everything else — no account, Stripe API unreachable, real
// requirement errors, or just a normal mid-onboarding account with no
// requirement errors yet — returns false. Mid-onboarding isn't distinguished
// from a real problem here; it reads as unhealthy (red badge) until
// onboarding completes.
export async function stripeConnectHealthcheck(
  companyId: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  const stripeAccountId = metadata?.stripeAccountId as string | undefined;
  if (!stripeAccountId) {
    return false;
  }

  const status = await getConnectAccountStatus(stripeAccountId);
  if (!status || status.requirementErrors.length) {
    return false;
  }

  if (status.chargesEnabled && status.payoutsEnabled) {
    return true;
  }

  return false;
}

export async function stripeConnectOnInstall(companyId: string): Promise<void> {
  return;
}

export async function stripeConnectOnUninstall(
  companyId: string
): Promise<void> {
  return;
}
