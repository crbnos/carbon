"use client";

import { useApiConfig } from "./config-context";

/** Resource "Base URL" chip — reflects the configured API instance. */
export function BaseUrl({ path }: { path: string }) {
  const { base } = useApiConfig();
  return (
    <div className="mt-[18px] mb-[32px] flex w-fit items-center gap-[10px] rounded-[8px] border border-[#E7E7E3] bg-white px-[12px] py-[8px] font-[family-name:var(--font-mono)] text-[13.5px] text-[rgba(38,35,35,0.8)]">
      <span className="text-[rgba(38,35,35,0.5)]">Base</span>
      {base}
      {path}
    </div>
  );
}
