import { STRIPE_CONNECT_ENABLED } from "@carbon/env";
import { Badge, Button, toast } from "@carbon/react";
import { useCallback, useState } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { pieceLogo } from "../integrations/piece-logo";

export const StripeConnectSettingsSchema = z.object({
  stripeAccountId: z.string().optional(),
  chargesEnabled: z.boolean().optional(),
  payoutsEnabled: z.boolean().optional(),
  autoEnableInvoicing: z.boolean().optional().default(true)
});

export const StripeConnect = defineIntegration({
  name: "Stripe Connect",
  id: "stripe-connect",
  // Only offered when the platform has a Stripe secret key configured — without
  // it every Connect call throws and the pull-sweep backstop no-ops, so the
  // whole feature is inert. Gated on the browser-safe STRIPE_CONNECT_ENABLED
  // flag (never the secret itself), mirroring how OAuth integrations gate on
  // their public clientId.
  active: STRIPE_CONNECT_ENABLED,
  category: "Payments",
  logo: pieceLogo("stripe"),
  description:
    "Connect your Stripe account to send invoices with direct online payment options to your customers, automatically updating payment statuses and AR ledger entries.",
  shortDescription: "Accept card and ACH payments directly on sales invoices.",
  images: [],
  setupInstructions: StripeConnectStatus,
  schema: StripeConnectSettingsSchema,
  settingGroups: [
    {
      name: "Invoicing Settings",
      description: "Configure payment options for sales invoices"
    }
  ],
  settings: [
    {
      name: "autoEnableInvoicing",
      label: "Default to Online Payments",
      description:
        "Automatically include Stripe online payment links on newly created sales invoices",
      group: "Invoicing Settings",
      type: "switch" as const,
      required: false,
      value: true
    }
  ],
  actions: [
    {
      id: "dashboard",
      label: "Open Express Dashboard",
      description: "View payouts, transactions, and account details in Stripe",
      endpoint: "/api/integrations/stripe-connect/dashboard"
    }
  ]
});

function ConnectStripeAccountButton({
  label,
  onPlatformError
}: {
  label: string;
  onPlatformError: (message: string) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/integrations/stripe-connect/connect", {
        method: "POST"
      });
      const data = await response.json();

      if (data?.redirectUrl) {
        window.open(data.redirectUrl, "_blank", "noopener,noreferrer");
        return;
      }

      // A platform-level misconfiguration (e.g. this Stripe account was
      // never set up as a Connect platform) isn't something retrying fixes —
      // switch the panel to a persistent "ask your administrator" state
      // instead of just a one-off toast the user could miss.
      if (data?.isPlatformConfigError) {
        onPlatformError(
          data.error || "Stripe Connect isn't set up on this platform yet."
        );
        return;
      }

      toast.error(data?.error || "Failed to start Stripe Connect onboarding");
    } catch {
      toast.error("Failed to start Stripe Connect onboarding");
    } finally {
      setIsLoading(false);
    }
  }, [onPlatformError]);

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleClick}
      isLoading={isLoading}
      isDisabled={isLoading}
    >
      {label}
    </Button>
  );
}

function AccountingAccountRow({
  label,
  value
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground truncate max-w-[60%] text-right">
        {value ?? "Not configured"}
      </span>
    </div>
  );
}

function StripeConnectStatus({
  metadata
}: {
  companyId: string;
  metadata?: Record<string, unknown>;
  installed?: boolean;
}) {
  const [platformError, setPlatformError] = useState<string | null>(null);

  // The loader always sets this for stripe-connect (even before any row
  // exists — see integrations.$id.tsx), so treat a missing value as
  // configured rather than silently showing State A on a loader hiccup.
  const platformConfigured = metadata?.platformConfigured !== false;
  const stripeAccountId = metadata?.stripeAccountId as string | undefined;
  const chargesEnabled = metadata?.chargesEnabled === true;
  const payoutsEnabled = metadata?.payoutsEnabled === true;
  const onboardingComplete = chargesEnabled && payoutsEnabled;
  const requirementErrors =
    (metadata?.requirementErrors as string[] | undefined) ?? [];
  const hasIssue = requirementErrors.length > 0;
  const email = metadata?.email as string | undefined;
  const displayName = metadata?.displayName as string | undefined;
  // A linked account already existing counts as "started" even if the flag
  // predates this field being introduced.
  const onboardingStarted =
    metadata?.onboardingStarted === true || !!stripeAccountId;

  const showPlatformIssue = !platformConfigured || !!platformError;

  const status = showPlatformIssue
    ? { label: "Not available", variant: "gray" as const }
    : !stripeAccountId
      ? { label: "Not connected", variant: "gray" as const }
      : onboardingComplete
        ? { label: "Active", variant: "green" as const }
        : hasIssue
          ? { label: "Needs attention", variant: "red" as const }
          : { label: "Pending onboarding", variant: "yellow" as const };

  const accountingAccounts = metadata?.accountingAccounts as
    | {
        bankCash: string | null;
        receivables: string | null;
        customerPaymentDiscount: string | null;
        customerWriteOff: string | null;
        fxGain: string | null;
        fxLoss: string | null;
        serviceCharge: string | null;
        rounding: string | null;
      }
    | undefined;

  return (
    <div className="flex flex-col gap-4">
      <input
        type="hidden"
        name="onboardingStarted"
        value={onboardingStarted ? "true" : "false"}
      />
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Connection status</span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {showPlatformIssue ? (
        // State A: nothing the installing user can do here — retrying won't
        // help until an administrator fixes the platform-level Stripe setup.
        <p className="text-xs text-muted-foreground">
          {platformError ??
            "Stripe isn't configured on this platform yet. Ask your administrator to add a Stripe secret key with Connect enabled."}
        </p>
      ) : !stripeAccountId ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Connecting creates a Stripe Express account for this company from
            your Company Settings details — no extra info needed here — then
            sends you to Stripe to finish onboarding.
          </p>
          <div>
            <ConnectStripeAccountButton
              label="Connect Stripe Account"
              onPlatformError={setPlatformError}
            />
          </div>
        </div>
      ) : !onboardingComplete ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {hasIssue
              ? "Stripe flagged an issue with this account:"
              : "Your Stripe account has been created, but onboarding isn't complete — card payments and payouts won't work until it is."}
          </p>
          {hasIssue && (
            <ul className="list-disc pl-4 text-xs text-muted-foreground">
              {requirementErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          <div>
            <ConnectStripeAccountButton
              label={hasIssue ? "Fix on Stripe" : "Finish Onboarding"}
              onPlatformError={setPlatformError}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            Onboarding is complete. Use "Open Express Dashboard" below to view
            payouts and transactions on Stripe.
          </p>
          {(displayName || email) && (
            <p className="text-xs text-muted-foreground">
              Connected as {displayName || email}
              {displayName && email ? ` (${email})` : ""}.
            </p>
          )}
        </div>
      )}

      {accountingAccounts && (
        <div className="border-t border-border pt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
              Accounting
            </span>
            <a
              href="/x/accounting/defaults"
              className="text-[0.6875rem] text-primary hover:underline"
            >
              Change in Account Defaults
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            GL accounts used when recording Stripe payments and fees.
          </p>
          <div className="flex flex-col divide-y divide-border/50">
            <AccountingAccountRow
              label="Bank / Cash"
              value={accountingAccounts.bankCash}
            />
            <AccountingAccountRow
              label="Accounts Receivable"
              value={accountingAccounts.receivables}
            />
            <AccountingAccountRow
              label="Customer Payment Discount"
              value={accountingAccounts.customerPaymentDiscount}
            />
            <AccountingAccountRow
              label="Customer Write-Off (Bad Debt)"
              value={accountingAccounts.customerWriteOff}
            />
            <AccountingAccountRow
              label="Realized FX Gain"
              value={accountingAccounts.fxGain}
            />
            <AccountingAccountRow
              label="Realized FX Loss"
              value={accountingAccounts.fxLoss}
            />
            <AccountingAccountRow
              label="Processing Fees"
              value={accountingAccounts.serviceCharge}
            />
            <AccountingAccountRow
              label="Rounding"
              value={accountingAccounts.rounding}
            />
          </div>
        </div>
      )}
    </div>
  );
}
