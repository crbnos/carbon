"use client";

import { HOST_PLACEHOLDER, useApiConfig } from "./config-context";

/** The `<your-host>` stand-in shown when the reader's instance is unknown.
 *  Clicking it opens the API configuration dialog, so the reader can replace
 *  every placeholder on the page with their own host in one step. */
export function HostPlaceholder() {
  const { openConfigurator } = useApiConfig();
  return (
    <button
      type="button"
      onClick={openConfigurator}
      title="Set your Carbon instance"
      className="rounded-[5px] border border-dashed border-ed-warm-500 bg-ed-brand/7 px-[5px] py-px font-mono text-ed-brand-ink transition-colors hover:border-ed-brand hover:bg-ed-brand/12"
    >
      {HOST_PLACEHOLDER}
    </button>
  );
}
