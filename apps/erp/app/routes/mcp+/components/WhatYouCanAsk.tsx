import { useInViewClass } from "../hooks/useInViewClass";
import { CopyButton } from "./CopyButton";
import { PROMPTS, SPECIFICITY } from "./mcp-content";

export function WhatYouCanAsk() {
  const ref = useInViewClass<HTMLElement>();
  return (
    <section
      ref={ref}
      id="ask"
      className="reveal relative py-[54px] scroll-mt-20"
    >
      <div className="bg-[#1f2023] bg-[url(/reviews.webp)] bg-cover bg-center text-white rounded-[12px] p-[28px]">
        {/* Label */}
        <div className="font-[var(--mono)] text-[0.68rem] tracking-[0.18em] uppercase text-white mb-[16px]">
          <span className="text-[var(--acc)] font-medium">FIG.02</span> · USE
          CASES
        </div>
        {/* Heading */}
        <h2
          className="font-medium tracking-[-0.03em] leading-[1.12] m-0 mb-[9px] text-white [text-wrap:balance]"
          style={{ fontSize: "1.6rem" }}
        >
          What you can ask
        </h2>
        {/* Subline */}
        <p className="text-zinc-300 max-w-[64ch] mb-[15px] text-[0.95rem] [text-wrap:pretty]">
          Things you can ask it to do:
        </p>
        {/* Prompts */}
        <div className="stagger flex flex-col gap-[7px]">
          {PROMPTS.map((p) => (
            <div
              key={p}
              className="flex items-center gap-[10px] justify-between bg-white/5 border border-white/10 rounded-[9px] py-[9px] px-[9px] pl-[13px] text-[0.85rem] transition-[background,border-color] duration-[160ms]"
            >
              <span className="flex-1">{p}</span>
              <CopyButton
                className="shrink-0 w-7 h-7 inline-flex items-center justify-center bg-white/[0.08] border border-white/[0.18] text-[#d8d8d7] rounded-md cursor-pointer transition-[transform,background,color,border-color] duration-150 [transition-timing-function:cubic-bezier(0.2,0,0,1)] hover:bg-[var(--acc)] hover:border-[var(--acc)] hover:text-white active:scale-[0.96] [&.done]:bg-[var(--acc)] [&.done]:border-[var(--acc)] [&.done]:text-white"
                text={p}
                label="Copy prompt"
              />
            </div>
          ))}
        </div>
        {/* Specificity block */}
        <div className="mt-[18px] border-t border-white/10 pt-[14px]">
          <p className="text-[0.8rem] text-zinc-400 m-0 mb-[10px]">
            The more specific the ask, the better the result:
          </p>
          {/* Too broad row */}
          <div className="grid grid-cols-[84px_1fr] gap-[12px] items-baseline py-[6px] text-[0.85rem]">
            <span className="font-[var(--mono)] text-[0.62rem] tracking-[0.08em] uppercase text-[#8f8f8d]">
              Too broad
            </span>
            <span className="text-[#8f8f8d]">{SPECIFICITY.broad}</span>
          </div>
          {/* Good/specific row */}
          <div className="grid grid-cols-[84px_1fr] gap-[12px] items-baseline py-[6px] text-[0.85rem]">
            <span className="font-[var(--mono)] text-[0.62rem] tracking-[0.08em] uppercase text-[var(--acc)]">
              Specific
            </span>
            <span className="text-[#dcdcdb]">{SPECIFICITY.specific}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
