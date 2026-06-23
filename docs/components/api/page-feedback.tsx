"use client";

import { useState } from "react";

// Negative feedback routes to GitHub Discussions so the reader can say what's wrong.
const DISCUSSIONS_URL = "https://github.com/crbnos/carbon/discussions/new?category=q-a";

const PILL_BASE =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-ed-13 font-medium no-underline transition-colors";
// `docs` — white card on paper; `editorial` — warm glass pill for the Guide surface.
const PILL_DOCS = `${PILL_BASE} border border-ed-warm-300 bg-white text-ed-ink/80 hover:border-ed-warm-500 hover:text-ed-ink`;
const PILL_EDITORIAL = `${PILL_BASE} glass-pill text-ink-ui hover:text-ed-ink`;

function ThumbUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M5 7.5L7.5 2c1 0 1.7.8 1.7 1.8V6h3.1c.8 0 1.4.7 1.2 1.5l-1 4.2c-.1.7-.8 1.1-1.5 1.1H5m0-5.3V13M5 7.5H3.2c-.6 0-1.1.5-1.1 1.1v3.1c0 .6.5 1.1 1.1 1.1H5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThumbDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M11 8.5L8.5 14c-1 0-1.7-.8-1.7-1.8V10H3.7c-.8 0-1.4-.7-1.2-1.5l1-4.2C3.6 3.6 4.3 3.2 5 3.2h6m0 5.3V3M11 8.5h1.8c.6 0 1.1-.5 1.1-1.1V4.3c0-.6-.5-1.1-1.1-1.1H11"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PageFeedback({ variant = "docs" }: { variant?: "docs" | "editorial" }) {
  const [thanked, setThanked] = useState(false);
  const editorial = variant === "editorial";
  const pill = editorial ? PILL_EDITORIAL : PILL_DOCS;

  if (thanked) {
    return (
      <p className={`m-0 text-ed-14 ${editorial ? "text-ink-faint" : "text-ed-ink/66"}`}>
        Thanks for your feedback!
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
      <span className={`text-ed-14 font-semi ${editorial ? "text-ink-ui" : "text-ed-ink"}`}>
        Was this page helpful?
      </span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setThanked(true)} className={pill}>
          <ThumbUp /> Yes
        </button>
        <a href={DISCUSSIONS_URL} target="_blank" rel="noreferrer" className={pill}>
          <ThumbDown /> No
        </a>
      </div>
    </div>
  );
}
