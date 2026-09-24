"use client";

/**
 * The changelog's Subscribe popover — email, RSS, Slack — the three channels
 * Linear offers. Email is managed from the reader's Carbon account (Account →
 * Notifications → "Changelog newsletter"), the way Linear does it: the
 * account's verified sign-in email is what gets subscribed, so there is no
 * form here and no double opt-in. RSS and Slack are copy-to-clipboard rows.
 */

import { useEffect, useRef, useState } from "react";
import { DEFAULT_APP_ORIGIN } from "./api/config-constants";
import { ApiConfigProvider, appOrigin, useApiConfig } from "./api/config-context";

const FEED_URL = "https://docs.carbon.ms/changelog/rss.xml";
const SLACK_COMMAND = `/feed subscribe ${FEED_URL}`;
// path.to.notificationSettings in the ERP.
const NEWSLETTER_SETTINGS_PATH = "/x/account/notifications";

/** The settings page on the reader's OWN instance when it is known — the region
 *  they picked on the API pages, or the `?app=` hint a referring ERP adds to its
 *  docs links — and Carbon Cloud US otherwise. A hardcoded app.carbon.ms sent EU,
 *  ITAR and self-hosted readers to an account they cannot sign in to. */
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

/** The popover reads the reader's instance through the same provider the API
 *  pages use; the changelog is outside that layout, so it mounts its own. */
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
        className="inline-flex items-center gap-1.5 rounded-lg border border-ed-hairline bg-[#F5F5F2] px-3.5 py-2 text-ed-14 font-book text-ink-ui transition-colors hover:border-[#D8D8D3]"
      >
        Subscribe
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
              <span>Manage in your Carbon account</span>
              <span aria-hidden="true">→</span>
            </a>
            <p className="m-0 mt-1.5 text-[12px] leading-normal text-ink-faint">
              Turn on “Changelog newsletter” under Account → Notifications.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <CopyRow label="RSS" value={FEED_URL} />
            <CopyRow label="Slack" value={SLACK_COMMAND} />
          </div>
          <p className="m-0 mt-3 text-[12px] leading-normal text-ink-faint">
            Paste the Slack command into any channel to get entries there.
          </p>
        </div>
      )}
    </div>
  );
}
