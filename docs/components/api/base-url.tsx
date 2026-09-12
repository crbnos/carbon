"use client";

import { useApiConfig } from "./config-context";
import { HostPlaceholder } from "./host-placeholder";

/** Resource "Base URL" chip — reflects the configured API instance, or invites the
 *  reader to name theirs when it is unknown. The path is always real either way. */
export function BaseUrl({ path }: { path: string }) {
  const { base } = useApiConfig();
  return (
    <div className="mt-[18px] mb-8 flex w-fit items-center gap-2.5 rounded-lg border border-ed-hairline bg-white px-3 py-2 font-mono text-ed-13 text-ed-ink/80">
      <span className="text-ed-ink/50">Base</span>
      {base === null ? <HostPlaceholder /> : base}
      {path}
    </div>
  );
}
