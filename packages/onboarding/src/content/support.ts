import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

// Guided-implementation upsell, shown on self-serve command centers, plus the
// booking link it points at. Single source so the copy and URL live in one place
// (the ERP route reads SUPPORT_BOOKING_URL to open the scheduler).
export const SUPPORT_BOOKING_URL =
  "https://calendly.com/chase-carbon-introduction/30min?month=2026-06";

export interface GuidedUpsell {
  eyebrow: MessageDescriptor;
  heading: MessageDescriptor;
  body: MessageDescriptor;
  points: MessageDescriptor[];
  cta: MessageDescriptor;
}

export const GUIDED_UPSELL: GuidedUpsell = {
  eyebrow: msg`Guided implementation`,
  heading: msg`Go live right the first time — with our team alongside you`,
  body: msg`You drive it; we make sure it's done right. Expert eyes on your setup, data, and go-live.`,
  points: [
    msg`Expert guidance`,
    msg`In the loop together`,
    msg`Set up the right way`
  ],
  cta: msg`Book a call with Carbon`
};
