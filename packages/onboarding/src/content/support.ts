// Guided-implementation upsell, shown on self-serve command centers, plus the
// booking link it points at. Single source so the copy and URL live in one place
// (the ERP route reads SUPPORT_BOOKING_URL to open the scheduler).
export const SUPPORT_BOOKING_URL =
  "https://calendly.com/chase-carbon-introduction/30min?month=2026-06";

export const GUIDED_UPSELL = {
  eyebrow: "Guided implementation",
  heading: "Go live right the first time — with our team alongside you",
  body: "You drive it; we make sure it's done right. Expert eyes on your setup, data, and go-live.",
  points: ["Expert guidance", "In the loop together", "Set up the right way"],
  cta: "Book a call with Carbon"
};
