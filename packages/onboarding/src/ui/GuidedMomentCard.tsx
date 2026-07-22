import { Button } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useCallback } from "react";
import { LuLock, LuPhone } from "react-icons/lu";
import { SUPPORT_BOOKING_URL } from "../content/support";
import { useHubActions, useTier } from "./state";

// The Guided moment cards — quiet locks placed at the moments of maximum
// relevance (peak pain at data loading, peak anxiety at switch week). Every
// click records its originating surface so upgrades can be attributed and
// stall-born clicks name the next friction point to automate. The guardrail:
// upgrades must rise alongside flat-or-rising zero-touch activation — locks
// monetizing friction instead of complexity are a product bug booked as
// revenue.

// Open the booking flow, stamping the originating surface (a fieldValue the
// fleet view reads, plus a PostHog event when the app loaded it).
export function useGuidedCta(source: string) {
  const { setField } = useHubActions();
  return useCallback(() => {
    setField(`lock.${source}`, new Date().toISOString());
    const posthog = (
      window as unknown as {
        posthog?: { capture?: (event: string, props?: object) => void };
      }
    ).posthog;
    posthog?.capture?.("implementation_guided_cta", { source });
    window.open(SUPPORT_BOOKING_URL, "_blank", "noopener,noreferrer");
  }, [setField, source]);
}

export function GuidedMomentCard({
  source,
  heading,
  body,
  cta
}: {
  source: string;
  heading: MessageDescriptor;
  body: MessageDescriptor;
  cta: MessageDescriptor;
}) {
  const { i18n } = useLingui();
  const tier = useTier();
  const openBooking = useGuidedCta(source);

  // Locks are a self-serve surface; paid tiers already have the humans.
  if (tier !== "self_serve") return null;

  return (
    <div className="rounded-xl border border-dashed bg-card/60 px-5 py-4 flex items-center gap-4">
      <LuLock className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{i18n._(heading)}</div>
        <div className="text-xs text-muted-foreground">{i18n._(body)}</div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<LuPhone />}
        onClick={openBooking}
      >
        {i18n._(cta)}
      </Button>
    </div>
  );
}

