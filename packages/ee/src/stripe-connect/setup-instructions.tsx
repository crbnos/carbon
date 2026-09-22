import { useState } from "react";
import { MdExpandMore } from "react-icons/md";

export function StripeConnectSetupInstructions() {
  const [isExpanded, setIsExpanded] = useState(false);

  const condensedSteps = [
    {
      number: 1,
      title: "Navigate to Stripe Connect Settings",
      description: "Open Settings → Integrations in Carbon OS"
    },
    {
      number: 2,
      title: "Click Connect with Stripe",
      description: "Carbon redirects you to Stripe's secure onboarding flow"
    },
    {
      number: 3,
      title: "Complete Verification",
      description: "Fill business details and link your bank account"
    }
  ];

  const fullSteps = [
    {
      number: 1,
      title: "Navigate to Billing / Integrations",
      description:
        "Log in to your Carbon OS workspace with administrator permissions."
    },
    {
      number: 2,
      title: "Open Settings → Integrations",
      description:
        "Open the main navigation menu and go to Settings → Integrations"
    },
    {
      number: 3,
      title: "Locate Stripe Connect Module",
      description:
        "Find the Stripe Connect module card in the integrations list."
    },
    {
      number: 4,
      title: "Start Onboarding Flow",
      description:
        "Click 'Connect with Stripe' on the Carbon OS dashboard. Carbon initiates an API request using Stripe's Account Links API to generate a temporary onboarding URL."
    },
    {
      number: 5,
      title: "Redirect to Stripe Hosted Flow",
      description:
        "You will be redirected to the secure, Stripe-hosted onboarding flow."
    },
    {
      number: 6,
      title: "Complete Account Verification",
      description:
        "Fill out your business details, tax identification numbers (EIN/SSN), and representative details."
    },
    {
      number: 7,
      title: "Link Your Bank Account",
      description: "Link your payout external bank account or debit card."
    },
    {
      number: 8,
      title: "Submit Verification Form",
      description: "Submit the verification form to return to Carbon OS."
    },
    {
      number: 9,
      title: "Verify Active Status",
      description:
        "Once redirected back to Carbon OS, confirm that the Stripe Connect status shows as Active / Connected."
    },
    {
      number: 10,
      title: "Test Webhooks",
      description:
        "Send a test transaction or process a test payout to confirm webhook events are syncing properly with your local Carbon OS ledger."
    }
  ];

  const displaySteps = isExpanded ? fullSteps : condensedSteps;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {displaySteps.map((step) => (
          <div key={step.number} className="flex gap-3">
            <div className="flex h-6 w-6 min-w-6 items-center justify-center rounded-full bg-primary/10">
              <span className="text-xs font-semibold text-primary">
                {step.number}
              </span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">{step.title}</p>
              <p className="text-sm text-muted-foreground">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          View full guide
          <MdExpandMore className="h-4 w-4" />
        </button>
      )}

      {isExpanded && (
        <button
          onClick={() => setIsExpanded(false)}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          Hide full guide
          <MdExpandMore className="h-4 w-4 rotate-180 transition-transform" />
        </button>
      )}
    </div>
  );
}
