"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Heading = { id: string; text: string; level: number };

/** "On this page" rail. Scans the rendered <main> for section headings and
 *  scroll-spies the active one. Picks up standalone h2/h3[id] (reference + MCP/API
 *  overview pages) plus the id'd <section> wrappers the API endpoint pages use, whose
 *  heading lives inside the section instead of carrying the id itself. */
export function TableOfContents() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        "main h2[id], main h3[id], main section[id]"
      )
    );
    const items = nodes
      .map((n) => {
        if (n.tagName === "SECTION") {
          const heading = n.querySelector("h2, h3");
          return { id: n.id, text: heading?.textContent ?? "", level: 2 };
        }
        return { id: n.id, text: n.textContent ?? "", level: n.tagName === "H3" ? 3 : 2 };
      })
      .filter((h) => h.text.trim());
    setHeadings(items);
    setActive(items[0]?.id ?? "");

    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b
        );
        setActive((top.target as HTMLElement).id);
      },
      { rootMargin: "-88px 0px -68% 0px", threshold: 0 }
    );
    for (const n of nodes) observer.observe(n);
    return () => observer.disconnect();
  }, [pathname]);

  if (headings.length === 0) return null;

  return (
    <nav className="sticky top-[88px] max-h-[calc(100dvh-120px)] overflow-y-auto scrollbar-hidden-until-scroll">
      <p className="m-0 mb-[10px] font-[family-name:var(--font-mono)] text-[11px] font-medium uppercase tracking-[0.08em] text-[rgba(38,35,35,0.5)]">
        On this page
      </p>
      <ul className="m-0 list-none border-l border-[#E7E7E3] p-0">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l py-[5px] text-[13.5px] leading-[140%] transition-colors ${
                h.level === 3 ? "pl-[24px]" : "pl-[14px]"
              } ${
                active === h.id
                  ? "border-[#1E84B0] text-[#1E84B0]"
                  : "border-transparent text-[rgba(38,35,35,0.68)] hover:text-[#262323]"
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
