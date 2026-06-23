"use client";

import { useState } from "react";
import type { ApiSamples } from "@/lib/api-types";
import { applyBase, applyConfig, useApiConfig } from "./config-context";
import { MethodBadge } from "./method-badge";

const LANGS: { key: keyof ApiSamples; label: string }[] = [
  { key: "curl", label: "cURL" },
  { key: "javascript", label: "JavaScript" },
  { key: "python", label: "Python" },
  { key: "go", label: "Go" },
];

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

/** Dark language picker — a native <select> styled to the panel chrome, with a custom
 *  chevron so it reads as one calm control instead of a row of tabs. */
function LangSelect({
  value,
  onChange,
}: {
  value: keyof ApiSamples;
  onChange: (v: keyof ApiSamples) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label="Code language"
        value={value}
        onChange={(e) => onChange(e.target.value as keyof ApiSamples)}
        className="cursor-pointer appearance-none rounded-md border border-ed-dark-line-2 bg-ed-dark-surface py-1 pl-2.5 pr-[26px] font-mono text-ed-12 text-ed-text-faint transition-colors hover:border-ed-dark-line-3 hover:text-white focus:border-ed-dark-line-3 focus:outline-none"
      >
        {LANGS.map((l) => (
          <option key={l.key} value={l.key} className="bg-ed-dark-bg text-ed-text-faint">
            {l.label}
          </option>
        ))}
      </select>
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute right-[9px] top-1/2 -translate-y-1/2"
      >
        <path
          d="M3 4.5L6 7.5L9 4.5"
          stroke="#8C8C88"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-ed-dark-line bg-ed-dark-bg shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      {children}
    </div>
  );
}

export function CodePanel({
  samples,
  highlighted,
  method,
  fullPath,
  response,
  responseHtml,
}: {
  samples: ApiSamples;
  highlighted: Record<keyof ApiSamples, string>;
  method: string;
  fullPath: string;
  response: string;
  responseHtml: string;
}) {
  const [lang, setLang] = useState<keyof ApiSamples>("curl");
  const { base, apiKey } = useApiConfig();

  return (
    <div className="sticky top-22 flex flex-col gap-4">
      <Panel>
        <div className="flex h-11 items-center justify-between gap-2 border-b border-ed-dark-line pr-2 pl-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <MethodBadge method={method} />
            <span className="truncate font-mono text-ed-12 text-ed-text-muted">
              {applyBase(fullPath, base)}
            </span>
          </div>
          <LangSelect value={lang} onChange={setLang} />
        </div>
        <div className="relative">
          <CopyButton text={applyConfig(samples[lang], base, apiKey)} />
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build-time shiki HTML */}
          <div
            className="api-shiki"
            dangerouslySetInnerHTML={{
              __html: applyConfig(highlighted[lang], base, apiKey, true),
            }}
          />
        </div>
      </Panel>

      {response ? (
        <Panel>
          <div className="flex h-10 items-center border-b border-ed-dark-line px-3.5">
            <span className="font-mono text-ed-12 tracking-[0.04em] text-ed-text-muted">
              Response
            </span>
          </div>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build-time shiki HTML */}
          <div
            className="api-shiki-response"
            dangerouslySetInnerHTML={{ __html: responseHtml }}
          />
        </Panel>
      ) : (
        <div className="rounded-[10px] border border-ed-hairline bg-ed-paper px-3.5 py-3 font-mono text-ed-13 text-ed-ink/63">
          204 No Content
        </div>
      )}
    </div>
  );
}
