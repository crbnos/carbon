"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

export type DocsNavNode = { label: string; url?: string; children?: DocsNavNode[] };

const GS_ACTIVE = "bg-ed-brand/10 font-demi text-ed-brand-ink";
const GS_IDLE = "text-ed-ink/80 hover:bg-ed-hairline/55 hover:text-ed-ink";
const GS_LINK = "block rounded-md px-2 py-1 text-ed-14 leading-[135%] transition-colors";
// Top-level group label (Platform, Product reference, …) vs nested sub-group label
// (the module groups inside Product reference) — one step quieter so the hierarchy reads.
const GROUP_LABEL =
  "font-mono text-ed-12 font-semibold uppercase tracking-[0.06em] text-ed-ink/60";
const SUBGROUP_LABEL =
  "font-mono text-ed-11 font-semibold uppercase tracking-[0.05em] text-ed-ink/50";

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
        <div key={key} className={depth === 0 ? "mt-2 first:mt-0.5" : "mt-1 first:mt-0"}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOverride((p) => ({ ...p, [key]: !open }))}
            className="flex w-full items-center gap-[7px] rounded-[7px] px-2 py-[5px] transition-colors hover:bg-ed-hairline/50"
          >
            <Chevron open={open} />
            <span className={depth === 0 ? GROUP_LABEL : SUBGROUP_LABEL}>{node.label}</span>
          </button>

          {open && (
            <div className="mt-0.5 mb-0.5 ml-[13px] flex flex-col gap-0.5 border-l border-ed-warm-150 py-0.5 pl-2">
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

  return <nav className="flex flex-col gap-0.5">{render(tree, 0, "")}</nav>;
}
