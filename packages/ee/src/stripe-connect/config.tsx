import { STRIPE_CONNECT_ENABLED } from "@carbon/env";
import { Badge, Button, toast } from "@carbon/react";
import type { ComponentProps } from "react";
import { useCallback, useState } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

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
  logo: StripeLogo,
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

function StripeLogo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 60 25"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Stripe logo"
      // The official Stripe wordmark. The shared render sites size logos by
      // height; clamp to a modest height and let the width follow so it never
      // overflows the drawer's icon box. `currentColor` keeps it theme-aware.
      style={{
        ...props.style,
        height: "1.25rem",
        width: "auto",
        maxWidth: "100%"
      }}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M59.6444 14.2813h-8.062c.1843 1.9296 1.5983 2.5476 3.2032 2.5476 1.6352 0 2.9534-.3656 4.0453-.9506v3.3179c-1.1186.7115-2.5964 1.1068-4.5645 1.1068-4.011 0-6.8218-2.5122-6.8218-7.4783 0-4.19441 2.3837-7.52509 6.3017-7.52509 3.912 0 5.9537 3.28038 5.9537 7.49819 0 .3982-.0372 1.261-.0556 1.4835Zm-5.9241-5.62407c-1.0294 0-2.1739.72812-2.1739 2.58387h4.2573c0-1.85362-1.0721-2.58387-2.0834-2.58387ZM40.9547 20.303c-1.4411 0-2.322-.6087-2.9133-1.0417l-.0088 4.6271-4.1181.8755-.0014-19.19053h3.7543l.0864 1.01784c.6035-.52914 1.6114-1.29157 3.2256-1.29162 2.8925 0 5.6162 2.6052 5.6162 7.39971 0 5.2327-2.6948 7.6037-5.6409 7.6037Zm-.959-11.35573c-.9453 0-1.5376.34559-1.9669.81586l.0245 6.11967c.3997.433.9763.7813 1.9424.7813 1.5231 0 2.5437-1.6575 2.5437-3.8745 0-2.1544-1.037-3.84233-2.5437-3.84233Zm-11.7602-3.3739h4.1341V20.0088h-4.1341V5.57337Zm0-4.694699L32.3696 0v3.35821l-4.1341.87868V.878671ZM23.9198 10.2223v9.7861h-4.1156V5.57296h3.6867l.1317 1.21751c1.0035-1.7722 3.0722-1.41321 3.6209-1.21594v3.78524c-.5242-.16908-2.2894-.42779-3.3237.86253Zm-8.5525 4.7221c0 2.4275 2.5988 1.6719 3.1263 1.4609v3.3522c-.5492.3013-1.5437.5458-2.8901.5458-2.4441 0-4.2773-1.7999-4.2773-4.2379l.0173-13.17658 4.0206-.85464.0032 3.5395h3.1278V9.0857h-3.1278v5.8588-.0001Zm-4.9069.7026c0 2.9645-2.31051 4.6562-5.73464 4.6562-1.41958 0-2.92289-.2761-4.453935-.9347v-3.9319c1.382085.7516 3.093705 1.315 4.457755 1.315.91864 0 1.53106-.2459 1.53106-1.0069C6.26064 13.7786 0 14.5192 0 9.95995 0 7.04457 2.27622 5.2998 5.61655 5.2998c1.36404 0 2.72806.20934 4.09208.75351V9.9317c-1.25265-.67618-2.84332-1.05979-4.09588-1.05979-.86296 0-1.44753.24965-1.44753.8924.0001 1.85329 6.29518.97249 6.29518 5.88279v-.0001Z"
      />
    </svg>
  );
}
