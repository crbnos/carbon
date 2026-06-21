"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";

/** Renders MDX fenced code in the same dark panel as the API playground CodeBlock. */
export function MdxCodeBlock({ title, children }: { title?: string; children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const text = ref.current?.textContent ?? "";
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="my-[18px] overflow-hidden rounded-xl border border-ed-dark-line bg-ed-dark-bg">
      {title && (
        <div className="flex h-[38px] items-center border-b border-ed-dark-line px-3.5">
          <span className="font-mono text-ed-11 tracking-[0.03em] text-ed-text-muted">
            {title}
          </span>
        </div>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={copy}
          className="absolute top-2.5 right-2.5 z-10 rounded-md border border-ed-dark-line-2 bg-ed-dark-surface px-2 py-[3px] font-mono text-ed-11 text-ed-text-faint transition-colors hover:border-ed-dark-line-3 hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <pre ref={ref} className="mdx-shiki m-0 overflow-x-auto">
          {children}
        </pre>
      </div>
    </div>
  );
}
