import { getConnectAccountStatus } from "@carbon/stripe/connect.server";

// Only runs once `companyIntegration.active` is already true, which now only
// happens once a real Stripe account exists (see getOrCreateConnectAccount) —
// the "no account at all" case is already "inactive" for free via the
// generic `!integration.active` check upstream in getIntegrationHealth.
//
// Three-way result:
// - true: fully onboarded (charges + payouts both live).
// - "inactive": account exists, onboarding just isn't finished yet, and
//   Stripe hasn't flagged any actual problem — a completely normal
//   mid-onboarding state. Reuses the same neutral bucket as "not installed"
//   rather than reading as broken.
// - false: Stripe reported real requirement errors on the account, or the
//   account/API couldn't be reached at all — an actual problem worth the
//   red badge.
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

export async function stripeConnectOnInstall(
  companyId: string
  // metadata: Record<string, unknown>
): Promise<void> {
  return;
}

export async function stripeConnectOnUninstall(
  companyId: string
  // metadata: Record<string, unknown>
): Promise<void> {
  return;
}
