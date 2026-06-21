"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

export type DocsNavNode = { label: string; url?: string; children?: DocsNavNode[] };

const GS_ACTIVE = "bg-[rgba(0,176,255,0.10)] font-[530] text-[#1E84B0]";
const GS_IDLE = "text-[rgba(38,35,35,0.8)] hover:bg-[rgba(231,231,227,0.55)] hover:text-[#262323]";
const GS_LINK = "block rounded-[6px] px-[8px] py-[4px] text-[14.5px] leading-[135%] transition-colors";
// Top-level group label (Platform, Product reference, …) vs nested sub-group label
// (the module groups inside Product reference) — one step quieter so the hierarchy reads.
const GROUP_LABEL =
  "font-[family-name:var(--font-mono)] text-[12.5px] font-[600] uppercase tracking-[0.06em] text-[rgba(38,35,35,0.6)]";
const SUBGROUP_LABEL =
  "font-[family-name:var(--font-mono)] text-[11px] font-[600] uppercase tracking-[0.05em] text-[rgba(38,35,35,0.5)]";

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

export function DocsNav({ tree }: { tree: DocsNavNode[] }) {
  const pathname = usePathname();
  // User toggles override the default open/closed; default is open at the top level and
  // for any branch that holds the active page (so deep module groups stay collapsed until
  // you're in them, but the current one is revealed on load).
  const [override, setOverride] = useState<Record<string, boolean>>({});

  const isActive = (url?: string) => !!url && pathname === url;
  const holdsActive = (node: DocsNavNode): boolean =>
    isActive(node.url) || !!node.children?.some(holdsActive);

  const render = (nodes: DocsNavNode[], depth: number, parentKey: string): ReactNode[] =>
    nodes.map((node) => {
      const key = `${parentKey}/${node.label}`;

      if (!node.children?.length) {
        return (
          <Link
            key={key}
            href={node.url ?? "#"}
            className={`${GS_LINK} ${isActive(node.url) ? GS_ACTIVE : GS_IDLE}`}
          >
            {node.label}
          </Link>
        );
      }

      const open = override[key] ?? (depth === 0 || holdsActive(node));
      return (
        <div key={key} className={depth === 0 ? "mt-[8px] first:mt-[2px]" : "mt-[4px] first:mt-0"}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOverride((p) => ({ ...p, [key]: !open }))}
            className="flex w-full items-center gap-[7px] rounded-[7px] px-[8px] py-[5px] transition-colors hover:bg-[rgba(231,231,227,0.5)]"
          >
            <Chevron open={open} />
            <span className={depth === 0 ? GROUP_LABEL : SUBGROUP_LABEL}>{node.label}</span>
          </button>

          {open && (
            <div className="mt-[2px] mb-[2px] ml-[13px] flex flex-col gap-[2px] border-l border-[#ECECE7] py-[2px] pl-[8px]">
              {node.url && (
                <Link
                  href={node.url}
                  className={`${GS_LINK} ${isActive(node.url) ? GS_ACTIVE : GS_IDLE}`}
                >
                  Overview
                </Link>
              )}
              {render(node.children, depth + 1, key)}
            </div>
          )}
        </div>
      );
    });

  return <nav className="flex flex-col gap-[2px]">{render(tree, 0, "")}</nav>;
}
