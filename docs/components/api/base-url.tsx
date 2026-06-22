"use client";

import { useApiConfig } from "./config-context";

/** Resource "Base URL" chip — reflects the configured API instance. */
export function BaseUrl({ path }: { path: string }) {
  const { base } = useApiConfig();
  return (
    <div className="mt-[18px] mb-8 flex w-fit items-center gap-2.5 rounded-lg border border-ed-hairline bg-white px-3 py-2 font-mono text-ed-13 text-ed-ink/80">
      <span className="text-ed-ink/50">Base</span>
      {base}
      {path}
    </div>
  );
}
