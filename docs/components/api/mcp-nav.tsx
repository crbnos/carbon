"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolNavModule } from "@/lib/tools-data";

const CLASS_DOT: Record<string, string> = {
  READ: "bg-[#3F9142]",
  WRITE: "bg-[#1E84B0]",
  DESTRUCTIVE: "bg-[#B3261E]",
};

const MCP_LINKS = [
  { label: "Overview", href: "/mcp" },
  { label: "Authentication", href: "/mcp/authentication" },
  { label: "Tools", href: "/mcp/tools" },
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

/** Tools are grouped under their module, so drop the redundant `<module>_` prefix from the label. */
function toolLabel(name: string, moduleSlug: string): string {
  return name.startsWith(`${moduleSlug}_`) ? name.slice(moduleSlug.length + 1) : name;
}

function ClassDot({ c }: { c: string }) {
  return (
    <span
      className={`h-[6px] w-[6px] shrink-0 rounded-full ${CLASS_DOT[c] || "bg-[rgba(38,35,35,0.4)]"}`}
      aria-label={c}
    />
  );
}

export function McpNav({ tools }: { tools: ToolNavModule[] }) {
  const pathname = usePathname();
  const parts = pathname.split("/");
  const activeTool = parts[1] === "mcp" && parts[2] === "tools" ? parts[3] : undefined;

  const activeToolModule = useMemo(() => {
    if (!activeTool) return undefined;
    return tools.find((m) => m.tools.some((t) => t.slug === activeTool))?.slug;
  }, [tools, activeTool]);

  const [open, setOpen] = useState<Set<string>>(() => new Set(activeToolModule ? [activeToolModule] : []));
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (activeToolModule)
      setOpen((p) => (p.has(activeToolModule) ? p : new Set(p).add(activeToolModule)));
  }, [activeToolModule]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div>
      <nav className="flex flex-col gap-[2px]">
        <div className="mb-[10px]">
          <p className={SECTION_LABEL}>Getting Started</p>
          {MCP_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${GS_LINK} ${pathname === item.href ? GS_ACTIVE : GS_IDLE}`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <p className={SECTION_LABEL}>Tools</p>
        {tools.map((m) => {
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
                  {m.tools.length}
                </span>
              </button>

              {isOpen && (
                <ul className="mt-[2px] mb-[6px] ml-[13px] list-none border-l border-[#ECECE7] py-[2px] pl-[8px]">
                  {m.tools.map((t) => {
                    const isActive = activeTool === t.slug;
                    return (
                      <li key={t.slug}>
                        <Link
                          ref={isActive ? activeRef : undefined}
                          href={`/mcp/tools/${t.slug}`}
                          title={`${t.name} · ${t.classification}`}
                          className={`flex items-center gap-[8px] rounded-[6px] px-[8px] py-[3.5px] leading-[135%] transition-colors ${
                            isActive ? GS_ACTIVE : GS_IDLE
                          }`}
                        >
                          <ClassDot c={t.classification} />
                          <span className="truncate font-[family-name:var(--font-mono)] text-[13px]">
                            {toolLabel(t.name, m.slug)}
                          </span>
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
