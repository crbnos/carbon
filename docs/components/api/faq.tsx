"use client";

import { useState } from "react";

export type FaqEntry = { q: string; a: string };

function FaqItem({ q, a }: FaqEntry) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[10px] border border-[#E7E7E3] bg-white transition-colors hover:border-[#D6D6D0]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-[12px] px-[16px] py-[13px] text-left"
      >
        <span className="text-[14.5px] font-[560] text-[#262323]">{q}</span>
        <span
          className={`shrink-0 text-[19px] leading-none text-[#1E84B0] transition-transform duration-200 ${
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
          <p className="m-0 px-[16px] pb-[14px] text-[14px] leading-[165%] text-[rgba(38,35,35,0.7)]">{a}</p>
        </div>
      </div>
    </div>
  );
}

export function Faq({ items }: { items: FaqEntry[] }) {
  return (
    <div className="mt-[16px] flex flex-col gap-[8px]">
      {items.map((it) => (
        <FaqItem key={it.q} q={it.q} a={it.a} />
      ))}
    </div>
  );
}
