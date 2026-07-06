import { cn } from "@carbon/react";
import { useState } from "react";
import { FAQ } from "./mcp-content";

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card border border-border rounded-[10px] px-[15px] py-[13px] mb-[8px] cursor-pointer transition-[border-color] duration-200 hover:border-[var(--acc)]">
      <button
        type="button"
        className="w-full bg-transparent border-none cursor-pointer font-[inherit] text-foreground text-left flex justify-between items-center font-semibold text-[0.9rem]"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {q}{" "}
        <span
          className={cn(
            "text-[var(--acc)] transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
            open && "rotate-45"
          )}
        >
          +
        </span>
      </button>
      <div
        className={cn(
          "text-muted-foreground text-[0.84rem] overflow-hidden transition-[max-height,margin] duration-300 ease-in-out",
          open ? "max-h-[150px] mt-[9px]" : "max-h-0"
        )}
      >
        {a}
      </div>
    </div>
  );
}

export function Faq() {
  return (
    <div className="flex flex-col">
      {FAQ.map((f) => (
        <FaqItem key={f.q} q={f.q} a={f.a} />
      ))}
    </div>
  );
}
