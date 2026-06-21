"use client";

import { useState } from "react";
import { applyConfig, useApiConfig } from "./config-context";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="absolute top-[10px] right-[10px] z-10 rounded-[6px] border border-[#3A3A38] bg-[#262624] px-[8px] py-[3px] font-[family-name:var(--font-mono)] text-[11px] text-[#C9C9C5] transition-colors hover:border-[#4A4A47] hover:text-white"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** A standalone shiki-highlighted code block (intro / prose), dark panel + copy. */
export function CodeBlock({ html, code, label }: { html: string; code: string; label?: string }) {
  const { base, apiKey } = useApiConfig();
  return (
    <div className="my-[18px] overflow-hidden rounded-[12px] border border-[#2A2A28] bg-[#1B1B1A]">
      {label && (
        <div className="flex h-[38px] items-center border-b border-[#2A2A28] px-[14px]">
          <span className="font-[family-name:var(--font-mono)] text-[11.5px] tracking-[0.03em] text-[#9A9A96]">
            {label}
          </span>
        </div>
      )}
      <div className="relative">
        <CopyButton text={applyConfig(code, base, apiKey)} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build-time shiki HTML */}
        <div className="api-shiki" dangerouslySetInnerHTML={{ __html: applyConfig(html, base, apiKey, true) }} />
      </div>
    </div>
  );
}
