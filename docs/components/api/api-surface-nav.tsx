"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { openSearch } from "@/components/search/search-command";
import { operationLabel, type ToolNavModule } from "@/lib/tools-data";

const CLASS_DOT: Record<string, string> = {
  READ: "bg-ed-green-strong",
  WRITE: "bg-ed-brand-ink",
  DESTRUCTIVE: "bg-ed-red",
};

const GETTING_STARTED = [
  { label: "Overview", href: "/api" },
  { label: "Connect over MCP", href: "/api/mcp" },
  { label: "Authentication", href: "/api/authentication" },
  { label: "Operations", href: "/api/operations" },
];

const GS_ACTIVE = "bg-ed-brand/10 font-demi text-ed-brand-ink";
const GS_IDLE = "text-ed-ink/80 hover:bg-ed-hairline/55 hover:text-ed-ink";
const SECTION_LABEL =
  "m-0 font-mono text-ed-12 font-semibold uppercase tracking-[0.06em] text-ed-ink/60";
const GS_LINK = "block rounded-md px-2 py-[3.5px] text-ed-14 leading-[135%] transition-colors";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      className={`shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="M4.5 3L7.5 6L4.5 9" stroke="rgba(38,35,35,0.48)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClassDot({ c }: { c: string }) {
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${CLASS_DOT[c] || "bg-ed-ink/40"}`}
      aria-label={c}
    />
  );
}

/**
 * Middle truncation: end-truncation erased exactly the characters that tell long
 * siblings apart — three adjacent rows all rendered `getCustomerItemPriceOve…`, and
 * singular/plural pairs differ only in their final letter. Keeping the tail intact
 * yields `getCustomerItemPr…Override` vs `…Overrides`. Short labels skip the split.
 */
function MidTruncatedLabel({ text }: { text: string }) {
  if (text.length <= 22) {
    return <span className="truncate font-mono text-ed-13">{text}</span>;
  }
  const tail = text.slice(-9);
  const head = text.slice(0, -9);
  return (
    <span className="flex min-w-0 font-mono text-ed-13">
      <span className="truncate">{head}</span>
      <span className="shrink-0">{tail}</span>
    </span>
  );
}

/** The Carbon API sidebar: getting-started links plus the operation catalog grouped by
 *  module. Finding one goes through the global palette (the button above opens it
 *  on the API surface); this tree is for browsing. Operation slugs are the oRPC
 *  operation ids, so each row links to `/api/operations/<slug>` — the same surface MCP
 *  `call_tool` and HTTP reach. */
export function ApiSurfaceNav({ operations }: { operations: ToolNavModule[] }) {
  const pathname = usePathname();
  const parts = pathname.split("/");
  const activeOp = parts[1] === "api" && parts[2] === "operations" ? parts[3] : undefined;

  const activeOpModule = useMemo(() => {
    if (!activeOp) return undefined;
    return operations.find((m) => m.tools.some((t) => t.slug === activeOp))?.slug;
  }, [operations, activeOp]);

  const [open, setOpen] = useState<Set<string>>(() => new Set(activeOpModule ? [activeOpModule] : []));
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (activeOpModule)
      setOpen((p) => (p.has(activeOpModule) ? p : new Set(p).add(activeOpModule)));
  }, [activeOpModule]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const totalOps = useMemo(
    () => operations.reduce((n, m) => n + m.tools.length, 0),
    [operations]
  );

  return (
    <div>
      <nav className="flex flex-col gap-0.5">
        <div className="mb-2.5">
          <p className={`${SECTION_LABEL} mb-[3px] px-2 py-1.5`}>Getting Started</p>
          {GETTING_STARTED.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${GS_LINK} ${pathname === item.href ? GS_ACTIVE : GS_IDLE}`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* Finding an operation among 1,495 is the palette's job — it searches
            names, parameters and descriptions across every surface. The icon opens
            it already filtered to the API, so this tree stays a browse tree and
            costs no vertical space. */}
        <div className="flex items-center justify-between px-2 pb-[3px] pt-1.5">
          <p className={SECTION_LABEL}>Carbon API</p>
          <button
            type="button"
            onClick={() => openSearch("tools")}
            title={`Search ${totalOps.toLocaleString()} operations (⌘K)`}
            aria-label="Search operations"
            className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-ed-ink/45 transition-colors hover:bg-ed-row-hover hover:text-ed-ink"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {operations.map((m) => {
          const isOpen = open.has(m.slug);
          return (
            <div key={m.slug}>
              <button
                type="button"
                onClick={() => {
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.slug)) next.delete(m.slug);
                    else next.add(m.slug);
                    return next;
                  });
                }}
                className="flex w-full items-center justify-between gap-2 rounded-[7px] px-2 py-[5px] transition-colors hover:bg-ed-hairline/50"
              >
                <span className="flex items-center gap-[7px]">
                  <Chevron open={isOpen} />
                  <span className="font-mono text-ed-12 font-semibold uppercase tracking-[0.06em] text-ed-ink/60">
                    {m.name}
                  </span>
                </span>
                <span className="font-mono text-ed-12 tabular-nums text-ed-ink/42">
                  {m.tools.length}
                </span>
              </button>

              {isOpen && (
                <ul className="mt-0.5 mb-1.5 ml-[13px] list-none border-l border-ed-warm-150 py-0.5 pl-2">
                  {m.tools.map((t) => {
                    const isActive = activeOp === t.slug;
                    return (
                      <li key={t.slug}>
                        <Link
                          ref={isActive ? activeRef : undefined}
                          href={`/api/operations/${t.slug}`}
                          title={`${t.name} · ${t.classification}`}
                          className={`flex items-center gap-2 rounded-md px-2 py-[3.5px] leading-[135%] transition-colors ${
                            isActive ? GS_ACTIVE : GS_IDLE
                          }`}
                        >
                          <ClassDot c={t.classification} />
                          <MidTruncatedLabel text={operationLabel(t.name, m.slug)} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
