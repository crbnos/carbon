// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

// Email is managed from the reader's Carbon account, so there is no form here.

import { useEffect, useRef, useState } from "react";
import { DEFAULT_APP_ORIGIN } from "./api/config-constants";
import { ApiConfigProvider, appOrigin, useApiConfig } from "./api/config-context";

const FEED_URL = "https://docs.carbon.ms/changelog/rss.xml";
const SLACK_COMMAND = `/feed subscribe ${FEED_URL}`;
const NEWSLETTER_SETTINGS_PATH = "/x/account/notifications";

// The reader's own instance when known (API-page region or the ERP's `?app=`
// hint), else Carbon Cloud US.
function useNewsletterSettingsUrl(): string {
  const { base, appBase } = useApiConfig();
  return `${appOrigin(base, appBase) ?? DEFAULT_APP_ORIGIN}${NEWSLETTER_SETTINGS_PATH}`;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-demi uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
        title="Copy to clipboard"
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-ed-hairline bg-[#F5F5F2] px-3 py-2 text-left font-mono text-[12px] text-ink-ui transition-colors hover:border-[#D8D8D3]"
      >
        <span className="truncate">{value}</span>
        <span className="shrink-0 text-[11px] font-sans text-ink-faint">
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
    </div>
  );
}

// The changelog sits outside the API layout, so it mounts its own provider.
export function ChangelogSubscribe() {
  return (
    <ApiConfigProvider>
      <SubscribePopover />
    </ApiConfigProvider>
  );
}

function SubscribePopover() {
  const newsletterSettingsUrl = useNewsletterSettingsUrl();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group relative inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97]"
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark" />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
        />
        <span className="text-on-dark relative z-10 text-ed-14 font-book tracking-[0.15px]">
          Subscribe
        </span>
        <span
          aria-hidden="true"
          className="text-on-dark relative z-10 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5"
        >
          →
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[21rem] rounded-xl border border-ed-hairline bg-[#FBFBF9] p-4 shadow-[0_12px_32px_rgba(38,35,35,0.10)]">
          <div className="mb-4">
            <div className="mb-1.5 text-[12px] font-demi uppercase tracking-[0.06em] text-ink-faint">
              Email
            </div>
            <a
              href={newsletterSettingsUrl}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-[#1E84B0] px-3.5 py-2 text-ed-14 font-book text-white no-underline transition-opacity hover:opacity-90"
            >
              <span>Turn on the email digest</span>
              <span aria-hidden="true">→</span>
            </a>
            <p className="m-0 mt-1.5 text-[12px] leading-normal text-ink-faint">
              Opens Account → Notifications in your Carbon instance.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <CopyRow label="RSS" value={FEED_URL} />
            <CopyRow label="Slack" value={SLACK_COMMAND} />
          </div>
          <p className="m-0 mt-3 text-[12px] leading-normal text-ink-faint">
            Paste into any Slack channel to post new entries there.
          </p>
        </div>
      )}
    </div>
  );
}
