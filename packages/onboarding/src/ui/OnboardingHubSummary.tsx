import { cn, IconButton } from "@carbon/react";
import type { ReactNode } from "react";
import { LuRocket, LuX } from "react-icons/lu";

type OnboardingHubSummaryProps = {
  label: string;
  done: number;
  total: number;
  // The single next thing to do (drives the home-screen hand-holding).
  nextLabel?: string;
  // The CTA (app supplies a react-router <Link> wrapped in a Button for SPA nav).
  action: ReactNode;
  // Hide the home card (per-user). The hub stays reachable from the nav.
  onDismiss?: () => void;
};

// Compact card shown on the ERP home screen while a hub is active, pointing at
// the next step and linking into the full hub.
export function OnboardingHubSummary({
  label,
  done,
  total,
  nextLabel,
  action,
  onDismiss
}: OnboardingHubSummaryProps) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="relative rounded-2xl border bg-gradient-to-bl from-card from-50% to-background shadow-button-base p-6 pr-12 flex items-center gap-5 mb-6">
      <div className="shrink-0 size-12 rounded-xl border flex items-center justify-center">
        <LuRocket className="text-xl text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold tracking-tight">{label}</h3>
          <span className="text-sm text-muted-foreground tabular-nums">
            {done}/{total} steps
          </span>
        </div>
        <div className="mt-2 h-2 w-full max-w-md rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              done === total ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {nextLabel ? (
          <p className="mt-2 text-sm text-muted-foreground truncate">
            Next:{" "}
            <span className="text-foreground font-medium">{nextLabel}</span>
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{action}</div>
      {onDismiss ? (
        <IconButton
          aria-label="Hide"
          icon={<LuX />}
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="absolute top-2 right-2 text-muted-foreground"
        />
      ) : null}
    </div>
  );
}
