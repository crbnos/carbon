"use client";

/* Request panel for a Carbon API operation.
 *
 * An operation is reachable over two transports — plain HTTP (`POST /api/v1/…`) and
 * the MCP `call_tool` meta-tool — so the transport is a tab, and HTTP additionally
 * gets a language picker. Chrome, copy button and language `<select>` mirror the Data
 * API's `code-panel.tsx` so both surfaces read as one product; samples run through the
 * same `applyConfig`, so the host/API-key configurator drives these too.
 */

import { useState } from "react";
import { applyConfig, useApiConfig } from "./config-context";
import {
  HTTP_LANG_LABELS as LANG_LABEL,
  HTTP_LANGS,
  type HttpLang,
  type SampleKey,
  type Transport,
} from "@/lib/operation-samples";

const TRANSPORT_LABEL: Record<Transport, string> = {
  http: "HTTP",
  mcp: "MCP",
};

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

function LangSelect({
  value,
  onChange,
}: {
  value: HttpLang;
  onChange: (v: HttpLang) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label="Code language"
        value={value}
        onChange={(e) => onChange(e.target.value as HttpLang)}
        className="cursor-pointer appearance-none rounded-md border border-ed-dark-line-2 bg-ed-dark-surface py-1 pl-2.5 pr-[26px] font-mono text-ed-12 text-ed-text-faint transition-colors hover:border-ed-dark-line-3 hover:text-white focus:border-ed-dark-line-3 focus:outline-none"
      >
        {HTTP_LANGS.map((l) => (
          <option key={l} value={l} className="bg-ed-dark-bg text-ed-text-faint">
            {LANG_LABEL[l]}
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

export function OperationPanel({
  samples,
  highlighted,
  httpPath,
  responseHtml,
}: {
  samples: Record<SampleKey, string>;
  highlighted: Record<SampleKey, string>;
  httpPath: string;
  /** Shiki HTML for the success envelope. */
  responseHtml?: string;
}) {
  const [transport, setTransport] = useState<Transport>("http");
  const [lang, setLang] = useState<HttpLang>("curl");
  const { base, apiKey, appBase } = useApiConfig();

  const key: SampleKey = transport === "http" ? `http.${lang}` : "mcp";

  return (
    <div className="flex flex-col gap-4">
      <Panel>
      <div className="flex h-11 items-center justify-between gap-2 border-b border-ed-dark-line pr-2 pl-2">
        <div
          role="tablist"
          aria-label="Transport"
          className="flex min-w-0 items-center gap-1"
        >
          {(Object.keys(TRANSPORT_LABEL) as Transport[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={transport === t}
              onClick={() => setTransport(t)}
              className={`rounded-md px-2.5 py-1 font-mono text-ed-12 transition-colors ${
                transport === t
                  ? "bg-ed-dark-surface text-white"
                  : "text-ed-text-faint hover:text-white"
              }`}
            >
              {TRANSPORT_LABEL[t]}
            </button>
          ))}
          <span className="ml-1.5 truncate font-mono text-ed-12 text-ed-text-muted">
            {transport === "http" ? `POST ${httpPath}` : "call_tool"}
          </span>
        </div>
        {transport === "http" && <LangSelect value={lang} onChange={setLang} />}
      </div>
      <div className="relative">
        <CopyButton
          text={applyConfig(samples[key], base, apiKey, false, appBase)}
        />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build-time shiki HTML */}
        <div
          className="api-shiki"
          dangerouslySetInnerHTML={{
            __html: applyConfig(highlighted[key], base, apiKey, true, appBase),
          }}
        />
      </div>
      </Panel>

      {responseHtml && (
        <Panel>
          {/* Native <details>, collapsed by default: the request is what a reader
              came for; the response shape is one click away. The sample stays in
              the DOM either way, so Cmd-F and the search index still reach it. */}
          <details className="group">
            <summary className="flex h-10 cursor-pointer list-none items-center justify-between px-3.5 transition-colors hover:bg-ed-dark-surface/60 group-open:border-b group-open:border-ed-dark-line [&::-webkit-details-marker]:hidden">
              <span className="font-mono text-ed-12 tracking-[0.04em] text-ed-text-muted">
                Response
              </span>
              <svg
                width="11"
                height="11"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
                className="transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
              >
                <path
                  d="M4.5 3L7.5 6L4.5 9"
                  stroke="#8C8C88"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build-time shiki HTML */}
            <div
              className="api-shiki"
              dangerouslySetInnerHTML={{ __html: responseHtml }}
            />
          </details>
        </Panel>
      )}
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
