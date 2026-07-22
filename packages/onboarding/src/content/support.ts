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

// The guided-implementation row in "How to reach us" (Go-Live page), shown to
// self-serve hubs only — paid tiers already have the guided motion. Mirrors the
// command-center upsell card; the CTA spells out what the call is about.
export const GUIDED_CONTACT = {
  channel: msg`Guided implementation`,
  detail: msg`Want our team alongside you? Expert eyes on your setup, data, and go-live.`,
  cta: msg`Book a call to discuss guided implementation`
};

// The Guided moment cards (blueprint §12) — each placed at its moment of
// maximum relevance. The lock sells labor, expertise, and assurance — never
// anything required to activate.
export interface GuidedMoment {
  source: string; // attribution tag, recorded on every click
  heading: MessageDescriptor;
  body: MessageDescriptor;
  cta: MessageDescriptor;
}

export const GUIDED_MOMENTS: Record<
  "loadData" | "crew" | "switchWeek",
  GuidedMoment
> = {
  loadData: {
    source: "load-data",
    heading: msg`Have us do this part`,
    body: msg`Send us your exports; we return your factory — loaded, checked, and explained. Data is where self-serve implementations stall most.`,
    cta: msg`Book a call`
  },
  crew: {
    source: "crew",
    heading: msg`We'll train your team live`,
    body: msg`Role-by-role sessions on your data, office and floor. Training is the easiest thing to buy and the hardest to fake.`,
    cta: msg`Book a call`
  },
  switchWeek: {
    source: "switch-week",
    heading: msg`Switch-day on-call`,
    body: msg`Our team stands by during your cutover. Near-zero drama, enormous perceived safety — because it's real safety.`,
    cta: msg`Book a call`
  }
};
