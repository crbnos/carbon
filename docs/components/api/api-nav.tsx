"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavModule } from "@/lib/api-data";

const METHOD_COLOR: Record<string, string> = {
  GET: "text-[#3F9142]",
  POST: "text-[#1E84B0]",
  PATCH: "text-[#9C7136]",
  DELETE: "text-[#B3261E]",
};
const METHOD_ABBR: Record<string, string> = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DEL",
};

const REST_API = [
  { label: "Overview", href: "/api-reference" },
  { label: "Authentication", href: "/api-reference/authentication" },
];

const GS_ACTIVE = "bg-[rgba(0,176,255,0.10)] font-[530] text-[#1E84B0]";
const GS_IDLE = "text-[rgba(38,35,35,0.8)] hover:bg-[rgba(231,231,227,0.55)] hover:text-[#262323]";
const SECTION_LABEL =
  "m-0 mb-[3px] px-[8px] py-[6px] font-[family-name:var(--font-mono)] text-[12.5px] font-[600] uppercase tracking-[0.06em] text-[rgba(38,35,35,0.6)]";
const GS_LINK = "block rounded-[6px] px-[8px] py-[3.5px] text-[14.5px] leading-[135%] transition-colors";

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

function ResourceIcon({ kind, active }: { kind: "table" | "view"; active?: boolean }) {
  const color = active ? "#1E84B0" : "rgba(38,35,35,0.46)";
  if (kind === "view") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-label="view">
        <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" stroke={color} strokeWidth="1.2" />
        <circle cx="8" cy="8" r="1.7" stroke={color} strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-label="table">
      <rect x="2" y="2.5" width="12" height="11" rx="1.6" stroke={color} strokeWidth="1.2" />
      <path d="M2 6.1h12M2 9.9h12M6.2 6.1v7.4" stroke={color} strokeWidth="1.05" />
    </svg>
  );
}

export function ApiNav({ tree }: { tree: NavModule[] }) {
  const pathname = usePathname();
  const parts = pathname.split("/");
  const activeModule = parts[2];
  const activeResource = parts[3];

  const [open, setOpen] = useState<Set<string>>(() => new Set(activeModule ? [activeModule] : []));
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!activeModule) return;
    setOpen((prev) => (prev.has(activeModule) ? prev : new Set(prev).add(activeModule)));
  }, [activeModule]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div>
      <nav className="flex flex-col gap-[2px]">
        <div className="mb-[10px]">
          <p className={SECTION_LABEL}>REST API</p>
          {REST_API.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${GS_LINK} ${pathname === item.href ? GS_ACTIVE : GS_IDLE}`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <p className={SECTION_LABEL}>Resources</p>
        {tree.map((m) => {
          const isOpen = open.has(m.slug);
          return (
            <div key={m.slug}>
              <button
                type="button"
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.slug)) next.delete(m.slug);
                    else next.add(m.slug);
                    return next;
                  })
                }
                className="flex w-full items-center justify-between gap-[8px] rounded-[7px] px-[8px] py-[5px] transition-colors hover:bg-[rgba(231,231,227,0.5)]"
              >
                <span className="flex items-center gap-[7px]">
                  <Chevron open={isOpen} />
                  <span className="font-[family-name:var(--font-mono)] text-[12.5px] font-[600] uppercase tracking-[0.06em] text-[rgba(38,35,35,0.6)]">
                    {m.name}
                  </span>
                </span>
                <span className="font-[family-name:var(--font-mono)] text-[12px] tabular-nums text-[rgba(38,35,35,0.42)]">
                  {m.resources.length}
                </span>
              </button>

              {isOpen && (
                <ul className="mt-[2px] mb-[6px] ml-[13px] list-none border-l border-[#ECECE7] py-[2px] pl-[8px]">
                  {m.resources.map((r) => {
                    const isActive = activeModule === m.slug && activeResource === r.slug;
                    const href = `/api-reference/${m.slug}/${r.slug}`;
                    return (
                      <li key={r.slug}>
                        <Link
                          ref={isActive ? activeRef : undefined}
                          href={href}
                          title={`${r.name} · ${r.kind}`}
                          className={`flex items-center gap-[7px] rounded-[6px] px-[8px] py-[3.5px] text-[14.5px] leading-[135%] transition-colors ${
                            isActive ? GS_ACTIVE : GS_IDLE
                          }`}
                        >
                          <ResourceIcon kind={r.kind} active={isActive} />
                          <span className="truncate">{r.name}</span>
                        </Link>
                        {isActive && r.endpoints.length > 0 && (
                          <ul className="m-0 mt-[2px] mb-[6px] list-none p-0">
                            {r.endpoints.map((e) => (
                              <li key={e.id}>
                                <a
                                  href={`${href}#${e.id}`}
                                  className="flex items-center gap-[9px] rounded-[6px] py-[3px] pr-[8px] pl-[12px] text-[13px] text-[rgba(38,35,35,0.66)] transition-colors hover:text-[#262323]"
                                >
                                  <span
                                    className={`w-[30px] shrink-0 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.03em] ${
                                      METHOD_COLOR[e.method] || ""
                                    }`}
                                  >
                                    {METHOD_ABBR[e.method] ?? e.method}
                                  </span>
                                  <span className="truncate">{e.title}</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
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
