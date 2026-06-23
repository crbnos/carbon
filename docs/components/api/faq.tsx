"use client";

import { useState } from "react";

export type FaqEntry = { q: string; a: string };

function FaqItem({ q, a }: FaqEntry) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[10px] border border-ed-hairline bg-white transition-colors hover:border-ed-warm-400">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-[13px] text-left"
      >
        <span className="text-ed-14 font-semi text-ed-ink">{q}</span>
        <span
          className={`shrink-0 text-ed-18 leading-none text-ed-brand-ink transition-transform duration-200 ${
            open ? "rotate-45" : ""
          }`}
          aria-hidden="true"
        >
          +
        </span>
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <p className="m-0 px-4 pb-3.5 text-ed-14 leading-[165%] text-ed-ink/70">{a}</p>
        </div>
      </div>
    </div>
  );
}

export function Faq({ items }: { items: FaqEntry[] }) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      {items.map((it) => (
        <FaqItem key={it.q} q={it.q} a={it.a} />
      ))}
    </div>
  );
}
