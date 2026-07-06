import { cn } from "@carbon/react";
import type React from "react";
import { useScrollSpy } from "../hooks/useScrollSpy";
import { TOC } from "./mcp-content";

const TOC_IDS = TOC.map((t) => t.id);

export function OnThisPageNav() {
  const active = useScrollSpy(TOC_IDS);
  const go = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    }
  };
  return (
    <aside className="hidden min-[880px]:block sticky top-[84px] self-start text-[0.85rem]">
      <div className="font-[var(--mono)] text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground mb-[13px]">
        On this page
      </div>
      <div className="toc-track">
        {TOC.map((t, i) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            onClick={(e) => go(e, t.id)}
            className={cn(
              "block py-[6px] text-muted-foreground hover:text-foreground transition-colors duration-[150ms]",
              i === active && "active text-foreground font-semibold",
              i < active && "passed"
            )}
          >
            {t.label}
          </a>
        ))}
      </div>
    </aside>
  );
}
