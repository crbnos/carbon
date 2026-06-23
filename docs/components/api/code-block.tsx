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
      className="absolute top-2.5 right-2.5 z-10 rounded-md border border-ed-dark-line-2 bg-ed-dark-surface px-2 py-[3px] font-mono text-ed-11 text-ed-text-faint transition-colors hover:border-ed-dark-line-3 hover:text-white"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** A standalone shiki-highlighted code block (intro / prose), dark panel + copy. */
export function CodeBlock({ html, code, label }: { html: string; code: string; label?: string }) {
  const { base, apiKey } = useApiConfig();
  return (
    <div className="my-[18px] overflow-hidden rounded-xl border border-ed-dark-line bg-ed-dark-bg">
      {label && (
        <div className="flex h-[38px] items-center border-b border-ed-dark-line px-3.5">
          <span className="font-mono text-ed-11 tracking-[0.03em] text-ed-text-muted">
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
