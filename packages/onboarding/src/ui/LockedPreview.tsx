import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuLock, LuPhone } from "react-icons/lu";
import { isPageLocked } from "../logic";
import type { PageDef } from "../types";
import { useGuidedCta } from "./GuidedMomentCard";
import { useTier } from "./state";

// A real page, content dimmed, one CTA — how self-serve sees the Guided plan's
// permanent surfaces. Invisible features can't create desire; real substance,
// greyed out, sells. Nothing required to activate is ever behind this.

export function LockedPreview({
  page,
  children
}: {
  page: PageDef;
  children: ReactNode;
}) {
  const tier = useTier();
  const openBooking = useGuidedCta(`locked:${page.slug}`);

  if (!isPageLocked(page, tier)) return <>{children}</>;

  return (
    <div className="relative">
      <div
        className="pointer-events-none select-none opacity-40 blur-[1px]"
        aria-hidden
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-start justify-center pt-24">
        <div className="rounded-2xl border bg-card shadow-lg px-8 py-6 max-w-md text-center flex flex-col items-center gap-3">
          <LuLock className="size-6 text-muted-foreground" />
          <div className="text-base font-medium">
            <Trans>Part of the Guided plan</Trans>
          </div>
          <p className="text-sm text-muted-foreground">
            <Trans>
              This page is real — Guided factories run their implementation on
              it, with our team inside it. Everything you need to activate stays
              free in your plan; this is the "we do it with you" layer.
            </Trans>
          </p>
          <Button leftIcon={<LuPhone />} onClick={openBooking}>
            <Trans>Book a call with Carbon</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}
