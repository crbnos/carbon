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
      className={`relative flex flex-col items-start gap-[2px] rounded-[10px] border px-[12px] py-[10px] text-left transition-colors ${
        active
          ? "border-[#00B0FF] bg-[rgba(0,176,255,0.07)]"
          : "border-[#E3E3DF] bg-white hover:border-[#CFCFC9]"
      }`}
    >
      <span className={`text-[13.5px] font-[560] ${active ? "text-[#1E84B0]" : "text-[#262323]"}`}>
        {title}
      </span>
      <span className="font-[family-name:var(--font-mono)] text-[11.5px] text-[rgba(38,35,35,0.5)]">
        {sub}
      </span>
      {active && <Check className="absolute right-[10px] top-[10px] text-[#1E84B0]" />}
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
          className="group mb-[14px] flex w-full items-center gap-[8px] rounded-[8px] border border-[#E3E3DF] bg-white px-[10px] py-[8px] text-left text-[rgba(38,35,35,0.58)] transition-colors hover:border-[#CFCFC9] data-[state=open]:border-[#CFCFC9]"
        >
          <ServerIcon />
          <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[13px] text-[#262323]">
            {host}
          </span>
          {apiKey && (
            <span
              title="API key set"
              className="inline-flex items-center gap-[3px] rounded-[5px] bg-[rgba(79,145,64,0.12)] px-[5px] py-[2px] text-[#4F9140]"
            >
              <KeyIcon />
            </span>
          )}
          <svg
            className="shrink-0 text-[rgba(38,35,35,0.48)] transition-transform group-data-[state=open]:rotate-180"
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
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-[rgba(38,35,35,0.32)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-[50%] z-[101] flex w-[calc(100vw-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-[#E3E3DF] bg-[#FBFBF8] shadow-[0_24px_60px_-12px_rgba(38,35,35,0.28)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          {/* Header */}
          <div className="flex items-start justify-between gap-[12px] border-b border-[#EAEAE6] px-[20px] py-[16px]">
            <div>
              <Dialog.Title className="m-0 text-[16px] font-[560] text-ink">API configuration</Dialog.Title>
              <Dialog.Description className="m-0 mt-[3px] text-[13px] leading-[150%] text-[rgba(38,35,35,0.6)]">
                Tune the base URL and key used across the code samples.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mr-[4px] -mt-[2px] shrink-0 rounded-[7px] p-[5px] text-[rgba(38,35,35,0.5)] transition-colors hover:bg-[rgba(231,231,227,0.7)] hover:text-[#262323]"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-[18px] px-[20px] py-[18px]">
            <section>
              <p className="m-0 mb-[8px] font-[family-name:var(--font-mono)] text-[11px] font-[600] uppercase tracking-[0.07em] text-[rgba(38,35,35,0.5)]">
                Environment
              </p>
              <div className="grid grid-cols-2 gap-[8px]">
                <ModeCard active={mode === "cloud"} onClick={() => setMode("cloud")} title="Carbon Cloud" sub="rest.carbon.ms" />
                <ModeCard active={mode === "self"} onClick={() => setMode("self")} title="Self-hosted" sub="Your instance" />
              </div>
              {mode === "self" && (
                <div className="mt-[8px]">
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
                    className={`w-full rounded-[8px] border bg-white px-[11px] py-[9px] font-[family-name:var(--font-mono)] text-[12.5px] text-[#262323] outline-none placeholder:text-[rgba(38,35,35,0.42)] ${
                      urlError ? "border-[#E5484D] focus:border-[#E5484D]" : "border-[#E3E3DF] focus:border-[#00B0FF]"
                    }`}
                  />
                  {urlError && (
                    <p className="mt-[5px] text-[11.5px] leading-[1.3] text-[#E5484D]">{urlError}</p>
                  )}
                </div>
              )}
            </section>

            <section>
              <p className="m-0 mb-[8px] font-[family-name:var(--font-mono)] text-[11px] font-[600] uppercase tracking-[0.07em] text-[rgba(38,35,35,0.5)]">
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
                  className="w-full rounded-[8px] border border-[#E3E3DF] bg-white py-[9px] pl-[11px] pr-[38px] font-[family-name:var(--font-mono)] text-[12.5px] text-[#262323] outline-none transition-colors placeholder:text-[rgba(38,35,35,0.42)] focus:border-[#00B0FF]"
                />
                {key && (
                  <button
                    type="button"
                    aria-label={showKey ? "Hide key" : "Show key"}
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-[6px] top-1/2 -translate-y-1/2 rounded-[6px] p-[5px] text-[rgba(38,35,35,0.5)] transition-colors hover:bg-[rgba(231,231,227,0.7)] hover:text-[#262323]"
                  >
                    <EyeIcon off={showKey} />
                  </button>
                )}
              </div>
              <p className="m-0 mt-[7px] text-[12px] leading-[150%] text-[rgba(38,35,35,0.55)]">
                Stored in this browser only and dropped into the samples. Never sent to Carbon.{" "}
                <a
                  href="https://app.carbon.ms/x/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#1E84B0] no-underline hover:underline"
                >
                  Create a key ↗
                </a>
              </p>
            </section>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-[10px] border-t border-[#EAEAE6] px-[20px] py-[14px]">
            <button
              type="button"
              onClick={reset}
              className="rounded-[8px] px-[10px] py-[8px] text-[13px] font-[460] text-[rgba(38,35,35,0.6)] transition-colors hover:bg-[rgba(231,231,227,0.7)] hover:text-[#262323]"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={save}
              className="group relative inline-flex h-[38px] items-center justify-center rounded-[8px] px-[18px]"
            >
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[8px] cta-btn-dark" />
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[8px] btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100" />
              <span className="text-on-dark relative z-10 text-[13.5px] font-[460] tracking-[0.15px]">Save</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
