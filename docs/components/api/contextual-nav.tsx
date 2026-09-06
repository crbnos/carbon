"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavModule } from "@/lib/api-data";
import type { ToolNavModule } from "@/lib/tools-data";
import { ApiNav } from "./api-nav";
import { ApiSurfaceNav } from "./api-surface-nav";

/**
 * One sidebar slot, one tree at a time. Stacking both catalogs (15 Carbon API
 * modules + 474 Data API resources) in a 280px column put the Data API section
 * below the fold — it added bulk AND nobody found it. Instead the path decides:
 * under /api/data the resource tree renders with a way back; everywhere else the
 * sidebar carries only the Carbon API, and the Data API is one quiet link at the
 * bottom — the escape hatch, sized like one.
 */
export function ContextualNav({
  operations,
  tree,
}: {
  operations: ToolNavModule[];
  tree: NavModule[];
}) {
  const pathname = usePathname();
  const inDataApi = pathname === "/api/data" || pathname.startsWith("/api/data/");

  if (inDataApi) {
    return (
      <div>
        <Link
          href="/api"
          className="mb-3 flex items-center gap-[7px] rounded-md px-2 py-1 text-ed-14 text-ed-brand-ink transition-colors hover:bg-ed-hairline/55"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M7.5 3L4.5 6L7.5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Carbon API
        </Link>
        <ApiNav tree={tree} />
      </div>
    );
  }

  return (
    <div>
      <ApiSurfaceNav operations={operations} />
      <div className="mt-4 border-t border-ed-hairline pt-3">
        <Link
          href="/api/data"
          className="flex items-center justify-between gap-2 rounded-[7px] px-2 py-[5px] transition-colors hover:bg-ed-hairline/50"
        >
          <span className="flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
              <ellipse cx="8" cy="4" rx="5.5" ry="2.3" stroke="rgba(38,35,35,0.5)" strokeWidth="1.2" />
              <path d="M2.5 4v8c0 1.27 2.46 2.3 5.5 2.3s5.5-1.03 5.5-2.3V4" stroke="rgba(38,35,35,0.5)" strokeWidth="1.2" />
              <path d="M2.5 8c0 1.27 2.46 2.3 5.5 2.3S13.5 9.27 13.5 8" stroke="rgba(38,35,35,0.5)" strokeWidth="1.2" />
            </svg>
            <span className="text-ed-14 text-ed-ink/80">Data API</span>
          </span>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
            <path d="M4.5 3L7.5 6L4.5 9" stroke="rgba(38,35,35,0.48)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <p className="m-0 px-2 pt-0.5 text-ed-12 leading-[145%] text-ed-ink/45">
          The escape hatch — direct table access.
        </p>
      </div>
    </div>
  );
}
