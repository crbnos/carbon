"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { DEFAULT_API_BASE, useApiConfig } from "./config-context";

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 ${className ?? ""}`}>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="9" width="12" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4.6" cy="4.75" r="0.7" fill="currentColor" />
      <circle cx="4.6" cy="11.25" r="0.7" fill="currentColor" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className={`shrink-0 ${className ?? ""}`}>
      <circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7.6 7.6 13 13M11 11l1.4-1.4M9.6 9.6 11 8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className={`shrink-0 ${className ?? ""}`}>
      <path d="M3 7.2l2.6 2.6L11 4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.2" />
      {off && <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />}
    </svg>
  );
}

/** Validate/normalize a user-entered base URL. Returns the cleaned URL or an error message. */
function parseBaseUrl(raw: string): { url: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: "Enter a URL" };
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { error: "Not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "Use http:// or https://" };
  }
  const host = u.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (host !== "localhost" && !isIp && !host.includes(".")) {
    return { error: "Enter a valid host (e.g. rest.carbon.ms)" };
  }
  return { url: (u.origin + u.pathname).replace(/\/+$/, "") };
}

function ModeCard({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-ed-brand bg-ed-brand/7"
          : "border-ed-warm-300 bg-white hover:border-ed-warm-500"
      }`}
    >
      <span className={`text-ed-13 font-semi ${active ? "text-ed-brand-ink" : "text-ed-ink"}`}>
        {title}
      </span>
      <span className="font-mono text-ed-11 text-ed-ink/50">
        {sub}
      </span>
      {active && <Check className="absolute right-2.5 top-2.5 text-ed-brand-ink" />}
    </button>
  );
}

export function Configurator() {
  const { base, setBase, isDefault, apiKey, setApiKey } = useApiConfig();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"cloud" | "self">("cloud");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [urlError, setUrlError] = useState("");
  const host = base.replace(/^https?:\/\//, "");

  // Seed the draft from current config whenever the dialog opens.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setMode(isDefault ? "cloud" : "self");
      setUrl(isDefault ? "" : base);
      setKey(apiKey);
      setShowKey(false);
      setUrlError("");
    }
    setOpen(next);
  };

  const save = () => {
    if (mode === "self") {
      const result = parseBaseUrl(url);
      if ("error" in result) {
        setUrlError(result.error);
        return;
      }
      setBase(result.url);
    } else {
      setBase(DEFAULT_API_BASE);
    }
    setApiKey(key);
    setOpen(false);
  };

  const reset = () => {
    setMode("cloud");
    setUrl("");
    setKey("");
    setUrlError("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="group mb-3.5 flex w-full items-center gap-2 rounded-lg border border-ed-warm-300 bg-white px-2.5 py-2 text-left text-ed-ink/58 transition-colors hover:border-ed-warm-500 data-[state=open]:border-ed-warm-500"
        >
          <ServerIcon />
          <span className="min-w-0 flex-1 truncate font-mono text-ed-13 text-ed-ink">
            {host}
          </span>
          {apiKey && (
            <span
              title="API key set"
              className="inline-flex items-center gap-[3px] rounded-[5px] bg-ed-green-text/12 px-[5px] py-0.5 text-ed-green-text"
            >
              <KeyIcon />
            </span>
          )}
          <svg
            className="shrink-0 text-ed-ink/48 transition-transform group-data-[state=open]:rotate-180"
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-ed-ink/32 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-[50%] z-[101] flex w-[calc(100vw-32px)] max-w-110 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-ed-warm-300 bg-ed-paper shadow-[0_24px_60px_-12px_rgba(38,35,35,0.28)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-ed-warm-150 px-5 py-4">
            <div>
              <Dialog.Title className="m-0 text-ed-16 font-semi text-ink">API configuration</Dialog.Title>
              <Dialog.Description className="m-0 mt-[3px] text-ed-13 leading-normal text-ed-ink/60">
                Tune the base URL and key used across the code samples.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-[4px] -mt-[2px] shrink-0 rounded-[7px] p-[5px] text-ed-ink/50 transition-colors hover:bg-ed-hairline/70 hover:text-ed-ink"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-[18px] px-5 py-[18px]">
            <section>
              <p className="m-0 mb-2 font-mono text-ed-11 font-semibold uppercase tracking-[0.07em] text-ed-ink/50">
                Environment
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ModeCard active={mode === "cloud"} onClick={() => setMode("cloud")} title="Carbon Cloud" sub="rest.carbon.ms" />
                <ModeCard active={mode === "self"} onClick={() => setMode("self")} title="Self-hosted" sub="Your instance" />
              </div>
              {mode === "self" && (
                <div className="mt-2">
                  <input
                    value={url}
                    autoFocus
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (urlError) setUrlError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                    }}
                    placeholder="https://api.your-domain.com"
                    aria-invalid={!!urlError}
                    className={`w-full rounded-lg border bg-white px-[11px] py-[9px] font-mono text-ed-12 text-ed-ink outline-none placeholder:text-ed-ink/42 ${
                      urlError ? "border-ed-red-bright focus:border-ed-red-bright" : "border-ed-warm-300 focus:border-ed-brand"
                    }`}
                  />
                  {urlError && (
                    <p className="mt-[5px] text-ed-11 leading-[1.3] text-ed-red-bright">{urlError}</p>
                  )}
                </div>
              )}
            </section>

            <section>
              <p className="m-0 mb-2 font-mono text-ed-11 font-semibold uppercase tracking-[0.07em] text-ed-ink/50">
                API key
              </p>
              <div className="relative">
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                  }}
                  type={showKey ? "text" : "password"}
                  placeholder="crbn_…"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-ed-warm-300 bg-white py-[9px] pl-[11px] pr-[38px] font-mono text-ed-12 text-ed-ink outline-none transition-colors placeholder:text-ed-ink/42 focus:border-ed-brand"
                />
                {key && (
                  <button
                    type="button"
                    aria-label={showKey ? "Hide key" : "Show key"}
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-[5px] text-ed-ink/50 transition-colors hover:bg-ed-hairline/70 hover:text-ed-ink"
                  >
                    <EyeIcon off={showKey} />
                  </button>
                )}
              </div>
              <p className="m-0 mt-[7px] text-ed-12 leading-normal text-ed-ink/55">
                Stored in this browser only and dropped into the samples. Never sent to Carbon.{" "}
                <a
                  href="https://app.carbon.ms/x/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ed-brand-ink no-underline hover:underline"
                >
                  Create a key ↗
                </a>
              </p>
            </section>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2.5 border-t border-ed-warm-150 px-5 py-3.5">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg px-2.5 py-2 text-ed-13 font-book text-ed-ink/60 transition-colors hover:bg-ed-hairline/70 hover:text-ed-ink"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={save}
              className="group relative inline-flex h-[38px] items-center justify-center rounded-lg px-[18px]"
            >
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark" />
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100" />
              <span className="text-on-dark relative z-10 text-ed-13 font-book tracking-[0.15px]">Save</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
