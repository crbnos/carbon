import { findNeighbour } from "fumadocs-core/page-tree";
import Link from "next/link";
import type { ReactNode } from "react";
import { source } from "@/lib/source";
import { PageFeedback } from "./page-feedback";

export type NavLink = { label: string; url: string };

/** Fumadocs tree names are ReactNode (often elements) — pull the plain text out. */
function text(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "object" && "props" in node) {
    return text((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d={dir === "left" ? "M8.5 3.5L5 7l3.5 3.5" : "M5.5 3.5L9 7l-3.5 3.5"}
        stroke="rgba(38,35,35,0.55)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Card({ dir, link }: { dir: "prev" | "next"; link: NavLink }) {
  const next = dir === "next";
  return (
    <Link
      href={link.url}
      className={`group flex items-center gap-[10px] rounded-[10px] border border-[#E7E7E3] bg-white px-[14px] py-[11px] no-underline transition-colors hover:border-[#D6D6D0] ${
        next ? "flex-row-reverse text-right" : ""
      }`}
    >
      <Chevron dir={next ? "right" : "left"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-[family-name:var(--font-mono)] text-[10.5px] font-[600] uppercase tracking-[0.07em] text-[rgba(38,35,35,0.45)]">
          {next ? "Next" : "Previous"}
        </span>
        <span className="truncate text-[14px] font-[560] text-[#262323] group-hover:text-[#1E84B0]">
          {link.label}
        </span>
      </span>
    </Link>
  );
}

/** Page footer: feedback prompt, then optional prev / next cards. */
export function ContentFooter({ prev, next }: { prev?: NavLink; next?: NavLink }) {
  return (
    <footer className="mt-[56px] border-t border-[#E7E7E3] pt-[24px]">
      <PageFeedback />
      {(prev || next) && (
        <nav className="mt-[22px] grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <div>{prev && <Card dir="prev" link={prev} />}</div>
          <div>{next && <Card dir="next" link={next} />}</div>
        </nav>
      )}
    </footer>
  );
}

/** ContentFooter with prev/next derived from the Fumadocs page tree (Reference pages). */
export function DocsFooter({ url }: { url: string }) {
  const { previous, next } = findNeighbour(source.getPageTree(), url);
  return (
    <ContentFooter
      prev={previous ? { label: text(previous.name), url: previous.url } : undefined}
      next={next ? { label: text(next.name), url: next.url } : undefined}
    />
  );
}
