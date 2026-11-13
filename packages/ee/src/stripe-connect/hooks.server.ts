// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { getConnectAccountStatus } from "@carbon/stripe/connect.server";
import { patchIntegrationState } from "../integrations/secrets";

const logger = getLogger("ee", "stripe-connect", "healthcheck");

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
  if (!status) return false;

  // The send gate (`getStripeConnectAccountId`) reads the STORED flags, and
  // the `account.updated` webhook that refreshes them is not proven to arrive
  // for accounts made with the v2 API. The integrations page runs this check,
  // so it saves the live flags when they changed. Best-effort: a failed save
  // never changes the answer.
  if (
    status.chargesEnabled !== metadata?.chargesEnabled ||
    status.payoutsEnabled !== metadata?.payoutsEnabled
  ) {
    try {
      await patchIntegrationState(
        getCarbonServiceRole(),
        companyId,
        "stripe-connect",
        {
          metadata: {
            chargesEnabled: status.chargesEnabled,
            payoutsEnabled: status.payoutsEnabled,
            detailsSubmitted: status.detailsSubmitted,
            requirementErrors: status.requirementErrors
          },
          updatedBy: "system"
        }
      );
    } catch (error) {
      logger.error("Failed to save the Stripe Connect account status", {
        companyId,
        stripeAccountId,
        error
      });
    }
  }

  if (status.requirementErrors.length) {
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
